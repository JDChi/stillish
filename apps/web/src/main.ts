import type { Stage } from "./convert";
import { photoFormat } from "./platform";
import { drawPreview } from "./preview";
import "./style.css";

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error("Missing element " + id);
  return node as T;
}

const input = element<HTMLInputElement>("file-input");
const choose = element<HTMLButtonElement>("choose");
const fileLabel = element("file-label");
const fileDetail = element("file-detail");
const preview = element("preview");
const thumbnail = element<HTMLCanvasElement>("thumbnail");
const convertButton = element<HTMLButtonElement>("convert");
const cancelButton = element<HTMLButtonElement>("cancel");
const download = element<HTMLAnchorElement>("download");
const downloadHelp = element("download-help");
const message = element("message");
const messageText = element("message-text");
const enginePercent = element("engine-percent");
const progressRow = element("progress-row");
const taskProgress = element<HTMLProgressElement>("task-progress");
const taskPercent = element("task-percent");
const format = photoFormat(navigator);
element("format").textContent = format === "apple" ? "Apple Live Photo · PVT ZIP" : "Motion Photo · JPG";

const stageText: Record<Stage, string> = {
  loading: "正在下载引擎（约 31 MB）…",
  initializing: "正在准备转换…",
  reading: "正在准备转换…",
  converting: "正在转换视频…",
  cover: "正在提取封面…",
  packaging: "正在生成实况照片…",
};

let selected: File | undefined;
let previewJob: AbortController | undefined;
let active: AbortController | undefined;
let objectUrl: string | undefined;

function setMessage(text: string, error = false): void {
  message.hidden = !text;
  if (messageText.textContent !== text) messageText.textContent = text;
  message.classList.toggle("error", error);
}

function setTaskProgress(label: string, percent?: number): void {
  if (taskProgress.getAttribute("aria-label") !== label) taskProgress.setAttribute("aria-label", label);
  if (percent === undefined) {
    taskProgress.removeAttribute("value");
  } else if (taskProgress.position < 0 || taskProgress.value !== percent) {
    taskProgress.value = percent;
  }
  const value = percent === undefined ? "" : percent + "%";
  if (taskPercent.textContent !== value) taskPercent.textContent = value;
}

function clearDownload(): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  download.removeAttribute("href");
  download.hidden = true;
  downloadHelp.hidden = true;
  convertButton.hidden = false;
}

function chooseFile(file: File): void {
  if (active) return;
  clearDownload();
  const supported = /\.(mp4|gif)$/i.test(file.name) && file.size > 0;
  selected = supported ? file : undefined;
  convertButton.disabled = !selected;
  convertButton.textContent = "开始转换";
  fileLabel.textContent = selected ? file.name : "选择文件";
  const size = file.size >= 1_000_000
    ? (file.size / 1_000_000).toFixed(1) + " MB"
    : Math.max(1, Math.round(file.size / 1_000)) + " KB";
  fileDetail.textContent = selected ? size + " · 点击更换" : "也可以拖到这里";
  choose.classList.toggle("has-file", !!selected);
  setMessage(supported ? "" : "请选择一个非空的 MP4 或动态 GIF。", !supported);
  previewJob?.abort();
  previewJob = undefined;
  choose.classList.remove("has-preview");
  preview.hidden = true;
  thumbnail.width = thumbnail.height = 0;
  if (!selected) return;

  const job = new AbortController();
  previewJob = job;
  void drawPreview(selected, thumbnail, job.signal).then(() => {
    if (job.signal.aborted) return;
    choose.classList.add("has-preview");
    preview.hidden = false;
  }).catch(() => {
    // Keep the filename available when the browser cannot decode a preview.
  }).finally(() => {
    if (previewJob === job) previewJob = undefined;
  });
}

choose.addEventListener("click", () => input.click());
input.addEventListener("change", () => {
  const file = input.files?.item(0);
  if (file) chooseFile(file);
  input.value = "";
});
choose.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = active ? "none" : "copy";
  choose.classList.toggle("dragging", !active);
});
choose.addEventListener("dragleave", () => choose.classList.remove("dragging"));
choose.addEventListener("drop", (event) => {
  event.preventDefault();
  choose.classList.remove("dragging");
  if (active || !event.dataTransfer) return;
  const { files } = event.dataTransfer;
  if (files.length > 1) {
    setMessage("每次只能选择一个文件。", true);
    return;
  }
  const file = files.item(0);
  if (file) chooseFile(file);
});

convertButton.addEventListener("click", async () => {
  if (!selected || active) return;
  clearDownload();
  const controller = new AbortController();
  active = controller;
  choose.disabled = true;
  convertButton.disabled = true;
  convertButton.textContent = "转换中";
  cancelButton.hidden = false;
  cancelButton.disabled = false;
  setMessage("正在准备转换…");
  setTaskProgress("转换状态");
  progressRow.hidden = false;

  let engineDisplayTimer: number | undefined;
  let engineDownloadPercent = 0;
  const showEngineProgress = () => {
    if (controller.signal.aborted) return;
    setMessage(stageText.loading);
    enginePercent.textContent = " " + engineDownloadPercent + "%";
    enginePercent.hidden = false;
  };
  const clearEngineProgress = () => {
    window.clearTimeout(engineDisplayTimer);
    engineDisplayTimer = undefined;
    enginePercent.hidden = true;
    enginePercent.textContent = "";
  };

  try {
    const { convert } = await import("./convert");
    const result = await convert(selected, format, controller.signal, (stage, percent) => {
      if (stage === "loading") {
        if (percent === undefined || percent === 100) return;
        engineDownloadPercent = percent;
        if (enginePercent.hidden) {
          // Give cached or very fast downloads time to finish before showing a separate status.
          engineDisplayTimer ??= window.setTimeout(showEngineProgress, 250);
        } else {
          showEngineProgress();
        }
        return;
      }

      if (engineDisplayTimer !== undefined) clearEngineProgress();
      setMessage(stageText[stage]);
      setTaskProgress(stage === "converting" ? "视频转换进度" : "转换状态", percent);
    });
    controller.signal.throwIfAborted();
    objectUrl = URL.createObjectURL(result.blob);
    download.href = objectUrl;
    download.download = result.filename;
    download.hidden = false;
    convertButton.hidden = true;
    if (format === "apple") {
      downloadHelp.textContent = "下载后解压得到 .pvt，可在 Mac 的「照片」中导入。";
    } else {
      downloadHelp.textContent = "用兼容 Motion Photo 的相册打开下载的 JPG。";
    }
    downloadHelp.hidden = false;
    setMessage("转换完成。");
  } catch (error) {
    const cancelled = controller.signal.aborted;
    convertButton.textContent = cancelled ? "开始转换" : "重试转换";
    setMessage(cancelled ? "已取消转换。" : error instanceof Error ? error.message : "转换失败，请重试。", !cancelled);
  } finally {
    clearEngineProgress();
    active = undefined;
    choose.disabled = false;
    convertButton.disabled = false;
    cancelButton.hidden = true;
    progressRow.hidden = true;
  }
});
cancelButton.addEventListener("click", () => {
  cancelButton.disabled = true;
  active?.abort();
});
