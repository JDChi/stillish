<h1 align="center">照样动 · Stillish</h1>

<p align="center"><a href="README.md">English</a></p>

<p align="center"><strong>把 MP4 视频和 GIF 动图变成手机相册能播放的实况照片。</strong></p>

<p align="center">
  Apple 芯片 Mac 命令行工具 · 本地转换 · Apple Live Photo 与 Android Motion Photo
</p>

Stillish 从视频里选一帧当封面，把短片和封面做成一张实况照片。用它可以把录屏、动图或日常视频带进手机相册，有声 MP4 会保留第一条音轨。

## 下载并转换

从发布页下载 Apple 芯片版，保存为 `stillish`。打开终端并进入下载目录，把示例中的文件名换成你的 MP4 或 GIF 路径。 [下载 Stillish](https://github.com/JDChi/stillish/releases/latest)

```sh
chmod +x stillish
./stillish demo.mp4
./stillish animation.gif
```

| 想在哪儿看 | 怎么转换 | 得到什么 |
| --- | --- | --- |
| Apple「照片」 | `./stillish demo.mp4` | `demo.pvt`，拖入 Mac「照片」导入，再通过 AirDrop 或 iCloud 照片传到 iPhone |
| 兼容 Motion Photo 的 Android 相册 | `./stillish demo.mp4 --target android` | `demoMP.jpg`，原样传到手机后在相册打开 |

**默认用中间帧当封面，转换整段 MP4 或一轮 GIF。** GIF 成品无声，透明区域填白。也可以截取片段，再挑一帧当封面。

```sh
./stillish demo.mp4 --start 2 --duration 3 --cover 1 --out ./out
```

上面的命令从原片第 2 秒开始截取 3 秒，并用片段内第 1 秒的画面当封面。默认输出到当前目录，已有同名成品时会提示。完整参数见 `./stillish --help`。

> **通过微信传输**时，把 `.pvt` 或 `MP.jpg` 压成 ZIP，当文件发送。手机上用文件管理器解压，再从相册打开 Android 成品。Apple 的 `.pvt` 可在 Mac 解压后导入「照片」。

转换在本机完成。首次转换时，如果电脑和工具缓存都缺少 FFmpeg，Stillish 会自动下载所需工具（约 33 MB）。
