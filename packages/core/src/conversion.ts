import type { ApplePhotoTiming } from "./formats";

export interface ClipOptions {
  start: number;
  duration?: number;
  cover?: number;
}

interface StreamInfo {
  index: number;
  codec_type: string;
  disposition?: { attached_pic?: number };
  duration?: string;
  nb_frames?: string;
  width: number;
  height: number;
}

export interface ProbeResult {
  streams?: StreamInfo[];
  format?: { format_name?: string; duration?: string };
}

const FPS = 30;
const GIF_INPUT = ["-f", "gif", "-ignore_loop", "1", "-min_delay", "1"];

function videoStream(info: ProbeResult): StreamInfo {
  const video = info.streams?.find((stream) => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  if (!video) throw new Error("输入没有可转换的视频轨道。");
  return video;
}

function sourceDuration(info: ProbeResult, video: StreamInfo): number {
  for (const value of [video.duration, info.format?.duration]) {
    const duration = Number(value);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  throw new Error("无法读取有效的视频时长。");
}

export function probeArgs(filename: string, gif = false): string[] {
  return ["-v", "error", "-show_streams", "-show_format", "-of", "json", ...(gif ? GIF_INPUT : []), filename];
}

export function transcodeArgs(
  info: ProbeResult, gif: boolean, source: string, movie: string, options: ClipOptions,
): string[] {
  if (!gif && !info.format?.format_name?.split(",").includes("mp4")) throw new Error("请输入有效的 MP4 文件。");
  const video = videoStream(info);
  if (gif && video.nb_frames === "1") throw new Error("请选择包含多帧的 GIF 动图。");
  const available = sourceDuration(info, video) - options.start;
  if (available <= 0) throw new Error("截取起点超出视频范围。");
  if (options.duration !== undefined && (options.duration <= 0 || options.duration > available + 1e-6)) {
    throw new Error("截取时长须大于 0 且处于视频范围内。");
  }
  const duration = Math.min(options.duration ?? available, available);
  if (options.cover !== undefined && options.cover >= duration) throw new Error("封面时间须位于截取片段内。");

  const start = options.start.toFixed(9);
  const length = duration.toFixed(9);
  const input = gif ? [...GIF_INPUT, "-trans_color", "0xffffffff"] : ["-ss", start];
  const clip = gif ? [] : ["-t", length];
  let filters = "scale=max(2\\,round(iw*sar/2)*2):max(2\\,round(ih/2)*2),setsar=1";
  if (gif) {
    // Resample before trimming so a cut can begin inside a GIF frame's hold.
    filters += ",fps=" + FPS + ":start_time=0,trim=start=" + start + ":duration=" + length + ",setpts=PTS-STARTPTS";
  }
  return [
    "-v", "error", "-nostdin", "-xerror", ...input, "-i", source, ...clip,
    "-map", "0:" + video.index, "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1",
    "-vf", filters, "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", movie,
  ];
}

export function selectCover(info: ProbeResult, cover?: number): ApplePhotoTiming {
  const video = videoStream(info);
  const frameCount = Number(video.nb_frames);
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) throw new Error("截取片段未产生可用的视频帧。");
  let frame = Math.floor(frameCount / 2);
  if (cover !== undefined) {
    const position = cover * FPS;
    const lower = Math.floor(position);
    // Preserve the rounding of the Python CLI when a timestamp is between two frames.
    const nearest = position - lower === 0.5 ? lower + lower % 2 : Math.round(position);
    frame = Math.min(nearest, frameCount - 1);
  }
  return { frame, frameCount, fps: FPS, width: video.width, height: video.height };
}

export function coverArgs(movie: string, frame: number, cover: string): string[] {
  return [
    "-v", "error", "-nostdin", "-i", movie, "-vf", "select=eq(n\\," + frame + ")",
    "-frames:v", "1", "-c:v", "mjpeg", "-q:v", "2", cover,
  ];
}

export function appleMovieArgs(movie: string, mov: string): string[] {
  return [
    "-v", "error", "-nostdin", "-i", movie, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
    "-c", "copy", "-movie_timescale", "60000", mov,
  ];
}
