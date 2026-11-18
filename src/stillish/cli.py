import argparse
import ctypes
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from .dependencies import MediaTools, StillishError, resolve_tools
from .formats import write_android, write_apple


_FPS = 30
_GIF_INPUT_OPTIONS = ("-f", "gif", "-ignore_loop", "1", "-min_delay", "1")


def _seconds(value: str) -> float:
    try:
        seconds = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("请输入以秒为单位的数字。") from exc
    if not math.isfinite(seconds) or seconds < 0:
        raise argparse.ArgumentTypeError("秒数须为非负有限值。")
    return seconds


def _run(*args: str | Path) -> str:
    result = subprocess.run(args, capture_output=True, text=True, errors="replace")
    if result.returncode:
        detail = result.stderr.strip() or f"退出码 {result.returncode}"
        raise StillishError(f"{Path(args[0]).name} 处理失败：{detail}")
    return result.stdout


def _probe(tools: MediaTools, filename: Path, *input_options: str) -> dict:
    return json.loads(_run(
        tools.ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json",
        *input_options, filename,
    ))


def _video(info: dict) -> dict:
    for stream in info.get("streams", []):
        if stream["codec_type"] == "video" and not stream.get("disposition", {}).get("attached_pic"):
            return stream
    raise StillishError("输入没有可转换的视频轨道。")


def _source_duration(info: dict, video: dict) -> float:
    for value in (video.get("duration"), info.get("format", {}).get("duration")):
        if value not in (None, "N/A"):
            duration = float(value)
            if math.isfinite(duration) and duration > 0:
                return duration
    raise StillishError("无法读取有效的视频时长。")


def _prepare(
    source: Path, temp: Path, tools: MediaTools, options: argparse.Namespace
) -> tuple[Path, Path, int, int]:
    is_gif = source.suffix.lower() == ".gif"
    info = _probe(tools, source, *(_GIF_INPUT_OPTIONS if is_gif else ()))
    if not is_gif and "mp4" not in info.get("format", {}).get("format_name", "").split(","):
        raise StillishError("请输入有效的 MP4 文件。")
    video = _video(info)
    if is_gif and video.get("nb_frames") == "1":
        raise StillishError("请选择包含多帧的 GIF 动图。")
    available = _source_duration(info, video) - options.start
    if available <= 0:
        raise StillishError("截取起点超出视频范围。")
    if options.duration is not None and (options.duration <= 0 or options.duration > available + 1e-6):
        raise StillishError("截取时长须大于 0 且处于视频范围内。")
    duration = min(options.duration, available) if options.duration is not None else available
    if options.cover is not None and options.cover >= duration:
        raise StillishError("封面时间须位于截取片段内。")

    filters = r"scale=max(2\,round(iw*sar/2)*2):max(2\,round(ih/2)*2),setsar=1"
    if is_gif:
        input_options = (*_GIF_INPUT_OPTIONS, "-trans_color", "0xffffffff")
        clip_options = ()
        # Resample before trimming so a cut can begin inside a GIF frame's hold.
        filters += (
            f",fps={_FPS}:start_time=0,"
            f"trim=start={options.start:.9f}:duration={duration:.9f},setpts=PTS-STARTPTS"
        )
    else:
        input_options = ("-ss", f"{options.start:.9f}")
        clip_options = ("-t", f"{duration:.9f}")

    movie = temp / "video.mp4"
    _run(
        tools.ffmpeg, "-v", "error", "-nostdin", "-xerror",
        *input_options, "-i", source, *clip_options,
        "-map", f"0:{video['index']}", "-map", "0:a:0?",
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-vf", filters,
        "-r", str(_FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", movie,
    )

    converted = _video(_probe(tools, movie))
    frame_count = int(converted.get("nb_frames", "0"))
    if frame_count < 1:
        raise StillishError("截取片段未产生可用的视频帧。")
    cover_frame = frame_count // 2 if options.cover is None else min(
        round(options.cover * _FPS), frame_count - 1,
    )
    cover = temp / "cover.jpg"
    _run(
        tools.ffmpeg, "-v", "error", "-nostdin", "-i", movie,
        "-vf", f"select=eq(n\\,{cover_frame})", "-frames:v", "1",
        "-c:v", "mjpeg", "-q:v", "2", cover,
    )
    return movie, cover, cover_frame, frame_count


def _publish(staged: Path, destination: Path) -> None:
    if sys.platform == "darwin":
        # macOS supports atomic rename with the RENAME_EXCL flag.
        rename = ctypes.CDLL(None, use_errno=True).renamex_np
        rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(os.fsencode(staged), os.fsencode(destination), 0x00000004):
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error), destination)
    elif os.name == "nt":
        staged.rename(destination)
    else:
        # Reserve the filename against other Stillish processes on other POSIX hosts.
        lock = destination.with_name(f".{destination.name}.lock")
        lock.mkdir()
        try:
            if os.path.lexists(destination):
                raise FileExistsError(str(destination))
            staged.rename(destination)
        finally:
            lock.rmdir()


def _convert(options: argparse.Namespace) -> Path:
    source = options.input.expanduser().absolute()
    if source.suffix.lower() not in {".mp4", ".gif"} or not source.is_file():
        raise StillishError("请输入一个存在的 .mp4 或 .gif 文件。")
    directory = options.out.expanduser().resolve()
    name = f"{source.stem}MP.jpg" if options.target == "android" else f"{source.stem}.pvt"
    destination = directory / name
    if os.path.lexists(destination):
        raise StillishError(f"成品已存在：{destination}")
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".stillish-", dir=directory) as path:
        tools = resolve_tools()
        temp = Path(path)
        movie, cover, frame, frame_count = _prepare(source, temp, tools, options)
        staged = temp / name
        if options.target == "android":
            write_android(cover, movie, staged, frame, _FPS)
        else:
            mov = temp / "unpaired.mov"
            _run(
                tools.ffmpeg, "-v", "error", "-nostdin", "-i", movie,
                "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
                "-c", "copy", "-movie_timescale", "60000", mov,
            )
            write_apple(cover, mov, staged, source.stem, frame, frame_count, _FPS)
        try:
            _publish(staged, destination)
        except FileExistsError as exc:
            raise StillishError(f"成品已存在：{destination}") from exc
    return destination


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="stillish", description="照样动 · 将 MP4 或 GIF 转成实况照片")
    parser.add_argument("input", type=Path, help="输入 MP4 或 GIF 动图文件")
    parser.add_argument("--target", choices=("apple", "android"), default="apple", help="输出格式，默认 apple")
    parser.add_argument("--out", type=Path, default=Path.cwd(), metavar="目录", help="输出目录，默认当前目录")
    parser.add_argument("--start", type=_seconds, default=0.0, metavar="秒", help="截取起点，默认 0")
    parser.add_argument("--duration", type=_seconds, metavar="秒", help="需要保留的时长，默认到片段末尾")
    parser.add_argument("--cover", type=_seconds, metavar="秒", help="片段内封面时间，默认中间帧")
    options = parser.parse_args(argv)
    try:
        print(_convert(options))
    except (StillishError, OSError, ValueError) as exc:
        print(f"stillish: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("stillish: 已取消。", file=sys.stderr)
        return 130
    return 0
