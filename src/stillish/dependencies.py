import hashlib
import os
import platform
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlopen

import certifi


_RELEASE = "ffmpeg-2026.06.11"
_ARCHIVE = "ffmpeg-macos-arm64.tar.gz"
_URL = f"https://github.com/vanloctech/ffmpeg-macos/releases/download/{_RELEASE}/{_ARCHIVE}"
_SHA256 = "26f5133f88d5ab1254cc03499acef42dae2dbc574dd26e0dade8c968420127e9"
_MAX_DOWNLOAD = 80 * 1024 * 1024
_MAX_BINARY = 120 * 1024 * 1024


class StillishError(Exception):
    """An error that should be shown without a traceback."""


@dataclass(frozen=True)
class MediaTools:
    ffmpeg: Path
    ffprobe: Path


def _usable(ffmpeg: Path, ffprobe: Path) -> MediaTools | None:
    if not ffmpeg.is_file() or not ffprobe.is_file():
        return None
    try:
        subprocess.run([ffprobe, "-version"], check=True, capture_output=True, timeout=10)
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"], check=True,
            capture_output=True, timeout=10, text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    encoders = {
        parts[1]
        for line in result.stdout.splitlines()
        if (parts := line.split()) and len(parts) > 1 and len(parts[0]) == 6
    }
    if not {"libx264", "aac", "mjpeg"} <= encoders:
        return None
    return MediaTools(ffmpeg, ffprobe)


def _at(directory: Path) -> MediaTools | None:
    return _usable(directory / "ffmpeg", directory / "ffprobe")


def _directory() -> Path:
    custom = os.environ.get("STILLISH_CACHE_DIR")
    base = Path(custom).expanduser() if custom else Path.home() / "Library" / "Caches" / "stillish"
    return base.resolve() / f"{_RELEASE}-macos-arm64"


def _download(destination: Path) -> None:
    print("正在下载 FFmpeg（约 33 MB）…", file=sys.stderr, flush=True)
    checksum = hashlib.sha256()
    downloaded = 0
    next_report = 5 * 1024 * 1024
    tls = ssl.create_default_context(cafile=certifi.where())
    with urlopen(_URL, timeout=30, context=tls) as response, destination.open("wb") as archive:
        while block := response.read(1024 * 1024):
            downloaded += len(block)
            if downloaded > _MAX_DOWNLOAD:
                raise StillishError("FFmpeg 下载超出预期大小。")
            checksum.update(block)
            archive.write(block)
            if sys.stderr.isatty() and downloaded >= next_report:
                print(f"  已下载 {downloaded / (1024 * 1024):.0f} MB", file=sys.stderr, flush=True)
                next_report += 5 * 1024 * 1024
    if checksum.hexdigest() != _SHA256:
        raise StillishError("FFmpeg 下载的 SHA-256 与发布值不符。")


def _extract(archive: Path, directory: Path) -> None:
    remaining = {"ffmpeg", "ffprobe"}
    with tarfile.open(archive, "r:gz") as package:
        for item in package:
            name = Path(item.name).name
            if name not in remaining:
                continue
            if not item.isfile() or not 0 < item.size <= _MAX_BINARY:
                raise StillishError(f"FFmpeg 归档中的 {name} 无效。")
            path = directory / name
            with package.extractfile(item) as source, path.open("xb") as output:
                shutil.copyfileobj(source, output)
            path.chmod(0o755)
            remaining.remove(name)
    if remaining:
        raise StillishError("FFmpeg 归档中缺少所需的可执行文件。")


def resolve_tools() -> MediaTools:
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if ffmpeg and ffprobe and (tools := _usable(Path(ffmpeg).resolve(), Path(ffprobe).resolve())):
        return tools

    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise StillishError("请将支持 H.264、AAC 和 JPEG 的 ffmpeg 与 ffprobe 加入 PATH。")

    directory = _directory()
    if tools := _at(directory):
        return tools

    try:
        directory.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".download-", dir=directory.parent) as temp:
            stage = Path(temp)
            archive = stage / _ARCHIVE
            _download(archive)
            _extract(archive, stage)
            if not _at(stage):
                raise StillishError("下载的 FFmpeg 无法运行或缺少转换所需编码器。")
            # Both replacements come from the same pinned release.
            directory.mkdir(exist_ok=True)
            for name in ("ffmpeg", "ffprobe"):
                (stage / name).replace(directory / name)
    except (OSError, tarfile.TarError) as exc:
        raise StillishError(f"准备 FFmpeg 失败：{exc}。可重试，或将现有版本加入 PATH。") from exc

    print("FFmpeg 已就绪。", file=sys.stderr, flush=True)
    return MediaTools(directory / "ffmpeg", directory / "ffprobe")
