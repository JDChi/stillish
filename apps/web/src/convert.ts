import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  appleMovieArgs, buildAndroidJpeg, buildApplePhoto, coverArgs,
  probeArgs, selectCover, sourceDuration, transcodeArgs,
} from "@stillish/core";
import type { ProbeResult } from "@stillish/core";
import { zipSync } from "fflate";
import type { PhotoFormat } from "./platform";

const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
// Exact decoded sizes for the pinned ESM assets. HTTP Content-Length may describe a compressed response.
const CORE_BYTES = 32_344_223;
let engine: FFmpeg | undefined;

export type Stage = "loading" | "initializing" | "reading" | "converting" | "cover" | "packaging";

export interface Download {
  blob: Blob;
  filename: string;
}

async function coreAsset(
  name: string, type: string, signal: AbortSignal, onChunk: (size: number) => void,
): Promise<Blob> {
  const response = await fetch(CORE + "/" + name, { signal });
  if (!response.ok) throw new Error("FFmpeg CDN returned " + response.status);
  if (!response.body) {
    const blob = await response.blob();
    onChunk(blob.size);
    return new Blob([blob], { type });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(blobBytes(value));
      onChunk(value.byteLength);
    }
    return new Blob(chunks, { type });
  } finally {
    reader.releaseLock();
  }
}

async function load(
  ffmpeg: FFmpeg, signal: AbortSignal, onStage: (stage: Stage, percent?: number) => void,
): Promise<void> {
  const assets = new AbortController();
  const abort = () => assets.abort();
  signal.addEventListener("abort", abort, { once: true });
  const urls: string[] = [];
  try {
    signal.throwIfAborted();
    let received = 0;
    let percent = 0;
    onStage("loading", percent);
    const onChunk = (size: number) => {
      received += size;
      const next = Math.min(99, Math.floor(received * 100 / CORE_BYTES));
      if (next !== percent) {
        percent = next;
        onStage("loading", percent);
      }
    };
    const [script, wasm] = await Promise.all([
      coreAsset("ffmpeg-core.js", "text/javascript", assets.signal, onChunk),
      coreAsset("ffmpeg-core.wasm", "application/wasm", assets.signal, onChunk),
    ]);
    signal.throwIfAborted();
    onStage("loading", 100);
    onStage("initializing");
    urls.push(URL.createObjectURL(script), URL.createObjectURL(wasm));
    await ffmpeg.load({ coreURL: urls[0], wasmURL: urls[1] });
  } catch (error) {
    signal.throwIfAborted();
    throw new Error("转换引擎加载失败。请检查网络后重试。", { cause: error });
  } finally {
    signal.removeEventListener("abort", abort);
    assets.abort();
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}

function filenameStem(name: string): string {
  const basename = name.split(/[\\/]/).at(-1) ?? "";
  const stem = basename.slice(0, -4).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return stem && stem !== "." && stem !== ".." ? stem : "stillish";
}

function assetId(): `${string}-${string}-${string}-${string}-${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function blobBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return new Uint8Array(bytes);
}

async function encodeCover(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  if (pixels.byteLength !== width * height * 4) throw new Error("封面的像素数据不完整。");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法生成封面。");
    const bytes = blobBytes(pixels);
    const rgba = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
    if (!jpeg || jpeg.type !== "image/jpeg") throw new Error("浏览器无法编码 JPEG 封面。");
    return new Uint8Array(await jpeg.arrayBuffer());
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function convert(
  file: File, format: PhotoFormat, signal: AbortSignal, onStage: (stage: Stage, percent?: number) => void,
): Promise<Download> {
  signal.throwIfAborted();
  const gif = /\.gif$/i.test(file.name);
  const input = gif ? "input.gif" : "input.mp4";
  const movie = "converted.mp4";
  const probeJson = "probe.json";
  const cover = "cover.rgba";
  const mov = "unpaired.mov";
  const stem = filenameStem(file.name);

  const ffmpeg = engine ??= new FFmpeg();
  const terminate = () => {
    ffmpeg.terminate();
    if (engine === ffmpeg) engine = undefined;
  };
  signal.addEventListener("abort", terminate, { once: true });

  const probe = async (path: string, isGif = false): Promise<ProbeResult> => {
    try {
      const code = await ffmpeg.ffprobe(["-o", probeJson, "-show_error", ...probeArgs(path, isGif)]);
      // This WASM core can leave the exit code at -1 even after writing its JSON.
      if (code !== 0 && code !== -1) throw new Error("ffprobe returned " + code);
      const json = await ffmpeg.readFile(probeJson, "utf8");
      await ffmpeg.deleteFile(probeJson);
      if (typeof json !== "string") throw new Error("Missing ffprobe JSON");
      const info = JSON.parse(json) as ProbeResult & { error?: unknown };
      if (info.error || !info.streams?.length) throw new Error("Missing media streams");
      return info;
    } catch (error) {
      signal.throwIfAborted();
      throw new Error("无法读取文件。请选择有效的 MP4 或动态 GIF。", { cause: error });
    }
  };
  const run = async (args: string[], message: string) => {
    let code: number;
    try {
      code = await ffmpeg.exec(args);
    } catch (error) {
      if (engine === ffmpeg) terminate();
      signal.throwIfAborted();
      throw new Error(message, { cause: error });
    }
    if (code !== 0) throw new Error(message);
  };
  const read = async (path: string): Promise<Uint8Array> => {
    const bytes = await ffmpeg.readFile(path);
    if (typeof bytes === "string") throw new Error("无法读取转换后的文件。");
    await ffmpeg.deleteFile(path);
    return bytes;
  };

  try {
    if (!ffmpeg.loaded) await load(ffmpeg, signal, onStage);
    onStage("reading");
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    await ffmpeg.writeFile(input, bytes);
    const info = await probe(input, gif);
    const args = transcodeArgs(info, gif, input, movie, { start: 0 });
    const durationUs = sourceDuration(info) * 1_000_000;
    let percent = 0;
    const reportProgress = ({ time }: { time: number }) => {
      // Before the first valid timestamp, WASM can report FFmpeg's large no-PTS sentinel.
      if (signal.aborted || !Number.isSafeInteger(time) || time < 0 || time > durationUs) return;
      const next = Math.min(99, Math.floor(time * 100 / durationUs));
      if (next > percent) {
        percent = next;
        onStage("converting", percent);
      }
    };
    onStage("converting", percent);
    ffmpeg.on("progress", reportProgress);
    try {
      await run(
        ["-stats_period", "0.2", ...args],
        "无法转换此文件。请检查文件是否完整，或换一个较短的片段。",
      );
      signal.throwIfAborted();
      onStage("converting", 100);
    } finally {
      ffmpeg.off("progress", reportProgress);
    }

    onStage("cover");
    await ffmpeg.deleteFile(input);
    const timing = selectCover(await probe(movie));
    // The single-thread WASM build can stall in the MJPEG encoder.
    await run(coverArgs(movie, timing.frame, cover, "rgba"), "无法提取封面。");
    const jpeg = await encodeCover(await read(cover), timing.width, timing.height);
    signal.throwIfAborted();
    onStage("packaging");
    if (format === "android") {
      const video = await read(movie);
      const prefix = buildAndroidJpeg(jpeg, video.byteLength, timing);
      return {
        filename: stem + "MP.jpg",
        blob: new Blob([blobBytes(prefix), blobBytes(video)], { type: "image/jpeg" }),
      };
    }

    await run(appleMovieArgs(movie, mov), "无法生成 Apple 实况照片的视频组件。");
    await ffmpeg.deleteFile(movie);
    const output = buildApplePhoto(jpeg, await read(mov), timing, assetId());
    const directory = stem + ".pvt/";
    const zip = zipSync({
      [directory + stem + ".jpg"]: output.jpeg,
      [directory + stem + ".mov"]: output.mov,
      [directory + "metadata.plist"]: output.plist,
    }, { level: 0 });
    return {
      filename: stem + ".pvt.zip",
      blob: new Blob([blobBytes(zip)], { type: "application/zip" }),
    };
  } finally {
    try {
      if (!signal.aborted && ffmpeg.loaded) {
        await Promise.allSettled([input, movie, probeJson, cover, mov].map((path) => ffmpeg.deleteFile(path)));
      } else if (engine === ffmpeg) {
        terminate();
      }
    } finally {
      signal.removeEventListener("abort", terminate);
    }
  }
}
