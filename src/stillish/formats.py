import plistlib
import shutil
import struct
import uuid
from pathlib import Path

from .apple.metadata import inspect_live_jpeg, inspect_live_mov, write_live_jpeg, write_live_mov
from .dependencies import StillishError


_XMP_HEADER = b"http://ns.adobe.com/xap/1.0/\x00"


def write_apple(
    photo: Path, movie: Path, package: Path, stem: str, frame: int, frame_count: int, fps: int
) -> None:
    package.mkdir()
    asset_id = str(uuid.uuid4()).upper()
    cover_time = frame / fps
    jpg, mov = package / f"{stem}.jpg", package / f"{stem}.mov"
    write_live_jpeg(photo, jpg, asset_id)
    write_live_mov(movie, mov, asset_id, cover_time, frame_count / fps, fps)
    timing = inspect_live_mov(mov)
    if (
        inspect_live_jpeg(jpg) != asset_id
        or timing.asset_id != asset_id
        or timing.sample_value != 0
        or abs(timing.still_time - cover_time) > 1 / 60000
    ):
        raise StillishError("Apple 实况照片的配对标识或封面时间校验失败。")
    (package / "metadata.plist").write_bytes(
        plistlib.dumps({"PFVideoComplementMetadataVersionKey": "1"})
    )


def write_android(photo: Path, movie: Path, output: Path, frame: int, fps: int) -> None:
    length = movie.stat().st_size
    timestamp = round(frame * 1_000_000 / fps)
    xmp = f"""<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:Camera="http://ns.google.com/photos/1.0/camera/"
 xmlns:Container="http://ns.google.com/photos/1.0/container/"
 xmlns:Item="http://ns.google.com/photos/1.0/container/item/"
 Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1"
 Camera:MotionPhotoPresentationTimestampUs="{timestamp}">
<Container:Directory><rdf:Seq>
<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li>
<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="{length}"/></rdf:li>
</rdf:Seq></Container:Directory>
</rdf:Description></rdf:RDF></x:xmpmeta>""".encode("utf-8")
    payload = _XMP_HEADER + xmp
    segment = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload

    with photo.open("rb") as source, movie.open("rb") as video, output.open("xb") as target:
        start = source.read(2)
        if start != b"\xff\xd8":
            raise StillishError("Android 实况封面不是有效的 JPEG。")
        target.write(start)
        marker = source.read(2)
        if marker == b"\xff\xe0":
            # Keep the JFIF APP0 segment immediately after SOI.
            size_bytes = source.read(2)
            size = int.from_bytes(size_bytes, "big")
            if size < 2:
                raise StillishError("Android 实况封面的 JPEG 段无效。")
            target.write(marker + size_bytes + source.read(size - 2))
        else:
            source.seek(2)
        target.write(segment)
        shutil.copyfileobj(source, target)
        shutil.copyfileobj(video, target)
