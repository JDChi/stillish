import { chmod, mkdir, mkdtemp, open, realpath, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { expandHome, runTool } from "./process";

const RELEASE = "ffmpeg-2026.06.11";
const ARCHIVE = "ffmpeg-macos-arm64.tar.gz";
const URL = "https://github.com/vanloctech/ffmpeg-macos/releases/download/" + RELEASE + "/" + ARCHIVE;
const SHA256 = "26f5133f88d5ab1254cc03499acef42dae2dbc574dd26e0dade8c968420127e9";
const MAX_DOWNLOAD = 80 * 1024 * 1024;
const MAX_BINARY = 120 * 1024 * 1024;
const TOOLS = ["ffmpeg", "ffprobe"] as const;

type FetchArchive = (url: string, options: RequestInit) => Promise<Response>;

export interface MediaTools {
  ffmpeg: string;
  ffprobe: string;
}

async function usable(tools: MediaTools, signal: AbortSignal): Promise<boolean> {
  try {
    for (const name of TOOLS) {
      if (!(await stat(tools[name])).isFile()) return false;
    }
    await runTool(tools.ffprobe, ["-version"], AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
    const output = await runTool(
      tools.ffmpeg, ["-hide_banner", "-encoders"], AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    );
    const encoders = new Set(
      output.split("\n").map((line) => line.trim().split(/\s+/)).filter(([flags]) => flags.length === 6)
        .map(([, name]) => name),
    );
    return ["libx264", "aac", "mjpeg"].every((name) => encoders.has(name));
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

function toolsAt(directory: string): MediaTools {
  return { ffmpeg: join(directory, "ffmpeg"), ffprobe: join(directory, "ffprobe") };
}

async function download(destination: string, signal: AbortSignal, fetchArchive: FetchArchive): Promise<void> {
  process.stderr.write("正在下载 FFmpeg（约 33 MB）…\n");
  const hash = new Bun.CryptoHasher("sha256");
  const timeout = new AbortController();
  const deadline = () => setTimeout(() => timeout.abort(new Error("下载 FFmpeg 超时")), 30_000);
  let timer = deadline();
  let size = 0;
  let nextReport = 5 * 1024 * 1024;
  try {
    const response = await fetchArchive(URL, { signal: AbortSignal.any([signal, timeout.signal]) });
    if (!response.ok || !response.body) throw new Error("下载 FFmpeg 失败，HTTP " + response.status);
    const reader = response.body.getReader();
    try {
      const output = await open(destination, "wx");
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          clearTimeout(timer);
          timer = deadline();
          size += value.length;
          if (size > MAX_DOWNLOAD) throw new Error("FFmpeg 下载超出预期大小。");
          hash.update(value);
          await output.writeFile(value);
          if (process.stderr.isTTY && size >= nextReport) {
            process.stderr.write("  已下载 " + Math.round(size / 1024 / 1024) + " MB\n");
            nextReport += 5 * 1024 * 1024;
          }
        }
      } finally {
        await output.close();
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
  }
  if (hash.digest("hex") !== SHA256) throw new Error("FFmpeg 下载的 SHA-256 与发布值不符。");
}

async function extract(archive: string, directory: string): Promise<void> {
  const files = await new Bun.Archive(await Bun.file(archive).bytes()).files();
  for (const name of TOOLS) {
    const matches = [...files].filter(([path]) => basename(path) === name);
    if (matches.length !== 1) throw new Error("FFmpeg 归档中缺少唯一的 " + name);
    const file = matches[0][1];
    if (file.size < 1 || file.size > MAX_BINARY) throw new Error("FFmpeg 归档中的 " + name + " 无效。");
    const path = join(directory, name);
    await Bun.write(path, file);
    await chmod(path, 0o755);
  }
}

export async function resolveTools(signal: AbortSignal, fetchArchive: FetchArchive = fetch): Promise<MediaTools> {
  const search = { PATH: process.env.PATH ?? "" };
  const ffmpeg = Bun.which("ffmpeg", search);
  const ffprobe = Bun.which("ffprobe", search);
  if (ffmpeg && ffprobe && await usable({ ffmpeg, ffprobe }, signal)) {
    return { ffmpeg: await realpath(ffmpeg), ffprobe: await realpath(ffprobe) };
  }
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("请将支持 H.264、AAC 和 JPEG 的 ffmpeg 与 ffprobe 加入 PATH。");
  }

  const base = resolve(expandHome(process.env.STILLISH_CACHE_DIR || "~/Library/Caches/stillish"));
  const directory = join(base, RELEASE + "-macos-arm64");
  const cached = toolsAt(directory);
  if (await usable(cached, signal)) return cached;
  try {
    await mkdir(dirname(directory), { recursive: true });
    const stage = await mkdtemp(join(base, ".download-"));
    try {
      const archive = join(stage, ARCHIVE);
      await download(archive, signal, fetchArchive);
      signal.throwIfAborted();
      await extract(archive, stage);
      const staged = toolsAt(stage);
      if (!(await usable(staged, signal))) throw new Error("下载的 FFmpeg 无法运行或缺少转换所需编码器。");
      signal.throwIfAborted();
      await mkdir(directory, { recursive: true });
      // Concurrent downloads provide the same verified release.
      for (const name of TOOLS) await rename(staged[name], cached[name]);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  } catch (error) {
    signal.throwIfAborted();
    throw new Error("准备 FFmpeg 失败：" + (error instanceof Error ? error.message : String(error))
      + "。可重试，或将现有版本加入 PATH。");
  }
  process.stderr.write("FFmpeg 已就绪。\n");
  return cached;
}
