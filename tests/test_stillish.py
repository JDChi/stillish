import io
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from stillish import dependencies
from stillish.apple.metadata import inspect_live_jpeg, inspect_live_mov
from stillish.cli import _publish


ROOT = Path(__file__).resolve().parents[1]
CAMERA = "{http://ns.google.com/photos/1.0/camera/}"
CONTAINER = "{http://ns.google.com/photos/1.0/container/}"
ITEM = "{http://ns.google.com/photos/1.0/container/item/}"


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "Requires FFmpeg")
class ConversionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.base = Path(cls.temp.name)
        for name, seconds, audio in (("silent", 3, False), ("voiced", 10, True)):
            args = ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=180x240:r=30"]
            if audio:
                args.extend(["-f", "lavfi", "-i", "sine=frequency=650:sample_rate=48000", "-c:a", "aac"])
            args.extend(["-t", str(seconds), "-c:v", "libx264", str(cls.base / f"{name}.mp4")])
            subprocess.run(args, check=True)

        frames = []
        for color in ("red", "lime", "blue"):
            frame = Image.new("RGBA", (180, 240))
            ImageDraw.Draw(frame).rectangle((30, 40, 149, 199), fill=color)
            frames.append(frame)
        frames[0].save(cls.base / "variable.GIF", save_all=True, append_images=frames[1:],
                       duration=[400, 900, 200], disposal=2, loop=0)
        frames[0].save(cls.base / "static.gif", duration=400)

    def run_cli(self, source, *args):
        return subprocess.run(
            [sys.executable, str(ROOT / "run_stillish.py"), str(self.base / source),
             "--out", str(self.base / self._testMethodName), *args],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
        )

    def probe(self, path):
        return json.loads(subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
            text=True,
        ))["streams"]

    def check_streams(self, path, duration, has_audio):
        streams = self.probe(path)
        video = next(stream for stream in streams if stream["codec_type"] == "video")
        self.assertEqual(video["codec_name"], "h264")
        self.assertAlmostEqual(float(video["duration"]), duration, delta=1 / 30)
        self.assertEqual((video["width"], video["height"]), (180, 240))
        audio = [stream for stream in streams if stream["codec_type"] == "audio"]
        self.assertEqual([stream["codec_name"] for stream in audio], ["aac"] if has_audio else [])
        subprocess.run(
            ["ffmpeg", "-v", "error", "-xerror", "-i", str(path), "-map", "0:v:0",
             "-map", "0:a:0?", "-f", "null", "-"],
            check=True,
        )

    def check_apple(self, package, stem, duration, cover, has_audio):
        photo = package / f"{stem}.jpg"
        video = package / f"{stem}.mov"
        info = inspect_live_mov(video)
        self.assertEqual(inspect_live_jpeg(photo), info.asset_id)
        self.assertEqual(info.sample_value, 0)
        self.assertAlmostEqual(info.still_time, cover, delta=1 / 60000)
        packets = json.loads(subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "d", "-show_packets", "-of", "json", str(video)],
            text=True,
        ))["packets"]
        self.assertEqual(len(packets), 1)
        self.assertAlmostEqual(float(packets[0]["pts_time"]), cover, delta=1 / 60000)
        self.assertEqual(plistlib.loads((package / "metadata.plist").read_bytes()),
                         {"PFVideoComplementMetadataVersionKey": "1"})
        self.check_streams(video, duration, has_audio)

    def check_android(self, path, duration, cover, has_audio):
        data = path.read_bytes()
        self.assertEqual(data[:4], b"\xff\xd8\xff\xe0")
        xmp_start = data.index(b"<x:xmpmeta")
        xmp_end = data.index(b"</x:xmpmeta>") + len(b"</x:xmpmeta>")
        xml = ET.fromstring(data[xmp_start:xmp_end])
        description = next(element for element in xml.iter() if CAMERA + "MotionPhoto" in element.attrib)
        self.assertTrue(path.name.endswith("MP.jpg"))
        self.assertEqual(description.attrib[CAMERA + "MotionPhoto"], "1")
        self.assertEqual(description.attrib[CAMERA + "MotionPhotoVersion"], "1")
        self.assertAlmostEqual(
            int(description.attrib[CAMERA + "MotionPhotoPresentationTimestampUs"]) / 1e6, cover, delta=1e-6,
        )
        items = list(xml.iter(CONTAINER + "Item"))
        self.assertEqual([item.get(ITEM + "Semantic") for item in items], ["Primary", "MotionPhoto"])
        length = int(items[1].attrib[ITEM + "Length"])
        self.assertEqual(data[-length - 2:-length], b"\xff\xd9")
        self.assertEqual(data[-length + 4:-length + 8], b"ftyp")
        with Image.open(io.BytesIO(data[:-length])) as image:
            image.verify()
        embedded = path.with_suffix(".mp4")
        embedded.write_bytes(data[-length:])
        self.check_streams(embedded, duration, has_audio)

    def test_both_formats_keep_duration_and_audio(self):
        for name, duration, audio in (("silent", 3, False), ("voiced", 10, True)):
            for target in ("apple", "android"):
                with self.subTest(name=name, target=target):
                    result = self.run_cli(f"{name}.mp4", "--target", target)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    path = Path(result.stdout.strip())
                    if target == "apple":
                        self.check_apple(path, name, duration, duration / 2, audio)
                    else:
                        self.check_android(path, duration, duration / 2, audio)

    def gif_frame_colors(self, video):
        # Sample the first RGB pixel of a 2x2 crop in each frame's colored center.
        pixels = subprocess.check_output(
            ["ffmpeg", "-v", "error", "-i", str(video), "-vf", "crop=2:2:90:120",
             "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
        )
        return [
            max(range(3), key=pixels[offset:offset + 3].__getitem__)
            for offset in range(0, len(pixels), 12)
        ]

    def test_gif_preserves_one_cycle_and_transparency_for_both_targets(self):
        for target in ("apple", "android"):
            with self.subTest(target=target):
                args = ("--target", "android") if target == "android" else ()
                result = self.run_cli("variable.GIF", *args)
                self.assertEqual(result.returncode, 0, result.stderr)
                path = Path(result.stdout.strip())
                if target == "apple":
                    self.assertEqual(path.name, "variable.pvt")
                    self.check_apple(path, "variable", 1.5, 22 / 30, False)
                    photo, video = path / "variable.jpg", path / "variable.mov"
                else:
                    self.assertEqual(path.name, "variableMP.jpg")
                    self.check_android(path, 1.5, 22 / 30, False)
                    photo, video = path, path.with_suffix(".mp4")
                self.assertEqual(self.gif_frame_colors(video), [0] * 12 + [1] * 27 + [2] * 6)
                with Image.open(photo) as image:
                    self.assertTrue(all(value >= 250 for value in image.getpixel((0, 0))))
                    red, green, blue = image.getpixel((90, 120))
                    self.assertGreater(green, max(red, blue))

    def test_gif_trim_can_start_inside_frame_hold(self):
        result = self.run_cli("variable.GIF", "--start", "0.6", "--duration", "0.3", "--cover", "0.1")
        self.assertEqual(result.returncode, 0, result.stderr)
        path = Path(result.stdout.strip())
        self.check_apple(path, "variable", 0.3, 0.1, False)
        self.assertEqual(self.gif_frame_colors(path / "variable.mov"), [1] * 9)

    def test_gif_rejects_static_and_corrupt_inputs(self):
        (self.base / "broken.gif").write_bytes(b"not a GIF")
        static = self.run_cli("static.gif")
        self.assertNotEqual(static.returncode, 0)
        self.assertIn("包含多帧的 GIF 动图", static.stderr)
        corrupt = self.run_cli("broken.gif")
        self.assertNotEqual(corrupt.returncode, 0)
        self.assertEqual(set((self.base / self._testMethodName).iterdir()), set())

    def test_trim_and_cover(self):
        result = self.run_cli("voiced.mp4", "--start", "2", "--duration", "3", "--cover", "0.8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.check_apple(Path(result.stdout.strip()), "voiced", 3, 0.8, True)

    def test_errors_and_existing_output(self):
        (self.base / "broken.mp4").write_text("broken")
        self.assertNotEqual(self.run_cli("broken.mp4").returncode, 0)
        self.assertNotEqual(self.run_cli("voiced.mp4", "--cover", "10").returncode, 0)
        first = self.run_cli("silent.mp4")
        self.assertEqual(first.returncode, 0, first.stderr)
        output = Path(first.stdout.strip())
        before = (output / "silent.mov").read_bytes()
        retry = self.run_cli("silent.mp4")
        self.assertNotEqual(retry.returncode, 0)
        self.assertIn("已存在", retry.stderr)
        self.assertEqual((output / "silent.mov").read_bytes(), before)
        self.assertEqual({path.name for path in output.parent.iterdir()}, {"silent.pvt"})

    def test_publish_leaves_existing_empty_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            staged = root / "source.pvt"
            staged.mkdir()
            (staged / "sample").touch()
            output = root / "target.pvt"
            output.mkdir()
            with self.assertRaises(FileExistsError):
                _publish(staged, output)
            self.assertTrue(staged.is_dir())
            self.assertEqual(list(output.iterdir()), [])


class DependencyTests(unittest.TestCase):
    def test_system_precedes_cache_and_download(self):
        system = dependencies.MediaTools(Path("/system/ffmpeg"), Path("/system/ffprobe"))
        with (
            patch.object(dependencies.shutil, "which", side_effect=[str(system.ffmpeg), str(system.ffprobe)]),
            patch.object(dependencies, "_usable", return_value=system),
            patch.object(dependencies, "_download") as download,
        ):
            self.assertEqual(dependencies.resolve_tools(), system)
            download.assert_not_called()

    def test_verified_download_is_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode="w:gz") as output:
                for tool in ("ffmpeg", "ffprobe"):
                    binary = b"test fixture"
                    member = tarfile.TarInfo(f"bin/{tool}")
                    member.size = len(binary)
                    output.addfile(member, io.BytesIO(binary))

            def fake_download(path):
                path.write_bytes(archive.getvalue())

            def valid_pair(directory):
                ffmpeg = directory / "ffmpeg"
                ffprobe = directory / "ffprobe"
                return dependencies.MediaTools(ffmpeg, ffprobe) if ffmpeg.is_file() and ffprobe.is_file() else None

            with (
                patch.object(dependencies.shutil, "which", return_value=None),
                patch.object(dependencies.sys, "platform", "darwin"),
                patch.object(dependencies.platform, "machine", return_value="arm64"),
                patch.object(dependencies, "_directory", return_value=root / "version"),
                patch.object(dependencies, "_at", side_effect=valid_pair),
                patch.object(dependencies, "_download", side_effect=fake_download) as download,
            ):
                first = dependencies.resolve_tools()
                self.assertEqual(dependencies.resolve_tools(), first)
                self.assertTrue(os.access(first.ffmpeg, os.X_OK))
                download.assert_called_once()

    def test_download_rejects_wrong_digest(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(
            dependencies, "urlopen", return_value=io.BytesIO(b"wrong archive"),
        ):
            with self.assertRaisesRegex(dependencies.StillishError, "SHA-256"):
                dependencies._download(Path(folder) / "archive")


if __name__ == "__main__":
    unittest.main()
