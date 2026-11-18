<h1 align="center">照样动 · Stillish</h1>

<p align="center"><strong>把一段 MP4 变成手机相册能播放的实况照片。</strong></p>

<p align="center">
  Apple 芯片 Mac 命令行工具 · 本地转换 · Apple Live Photo 与 Android Motion Photo
</p>

Stillish 从视频里选一帧当封面，把短片和封面做成一张实况照片。用它可以把录屏、动画或日常视频带进手机相册，有声视频会保留声音。

## 下载并转换

在 [GitHub Releases](https://github.com/JDChi/stillish/releases) 的 **Assets** 中下载 `stillish`。它是 Apple 芯片 Mac 可直接运行的单文件程序，自带 Python。在终端进入下载目录，把 `demo.mp4` 换成你的视频路径。

```sh
chmod +x stillish
./stillish demo.mp4
```

如需校验下载文件，把同一版本的 `SHA256SUMS.txt` 放到同一目录，运行 `shasum -a 256 -c SHA256SUMS.txt`。

| 想在哪儿看 | 怎么转换 | 得到什么 |
| --- | --- | --- |
| Apple「照片」 | `./stillish demo.mp4` | `demo.pvt`，拖入 Mac「照片」导入，再通过 AirDrop 或 iCloud 照片传到 iPhone |
| 兼容 Motion Photo 的 Android 相册 | `./stillish demo.mp4 --target android` | `demoMP.jpg`，原样传到手机后在相册打开 |

**默认用中间帧当封面，保留原片时长和第一条音轨。** 也可以截取片段，再挑一帧当封面。

```sh
./stillish demo.mp4 --start 2 --duration 3 --cover 1 --out ./out
```

上面的命令从原片第 2 秒开始截取 3 秒，并用片段内第 1 秒的画面当封面。默认输出到当前目录，已有同名成品时会提示。完整参数见 `./stillish --help`。

> **通过微信传输**时，把 `.pvt` 或 `MP.jpg` 压成 ZIP，当文件发送。手机上用文件管理器解压，再从相册打开 Android 成品。Apple 的 `.pvt` 可在 Mac 解压后导入「照片」。

转换时优先使用系统已有的 `ffmpeg` 和 `ffprobe`，其次使用工具缓存。两处都缺时，首次转换会下载约 33 MB 的 FFmpeg 并校验，再接着转换。视频始终在本机处理。 [FFmpeg 依赖发行包](https://github.com/vanloctech/ffmpeg-macos/releases/expanded_assets/ffmpeg-2026.06.11)

## 在 Mac 上构建

在 Apple 芯片 Mac 上使用 Python 3.12 从源码构建，产物是可直接运行的单个文件 `dist/stillish`。

```sh
git clone https://github.com/JDChi/stillish.git
cd stillish
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[build]'
./scripts/build-macos.sh
```

## 格式与兼容性

Apple 版已通过 macOS PhotoKit 的配对资源加载检查。Android 版实现 Google Motion Photo 1.0，已确认一份样片通过微信传 ZIP、解压后能在 Android 相册中显示为实况。厂商相册的兼容性因设备而异，小红书发布预览的表现仍待实测。 [技术说明与验证记录](docs/TECHNICAL.md)

[开发与复验](AGENTS.md) · [第三方代码署名](src/stillish/licenses/NOTICE.txt)

## 发布新版本

在 `pyproject.toml` 中更新版本并将提交合入 `main`，再切到该提交，创建并推送匹配的标签。以下以 `0.1.0` 为例。

```sh
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions 会在 Apple 芯片 Mac 上运行测试并构建，验证通过后将 `stillish` 和 `SHA256SUMS.txt` 上传到该版本的 GitHub Release。
