# 照样动 · Stillish 技术说明

Stillish 是一个把 MP4 和 GIF 转为实况照片的本地 CLI。单文件 CLI 运行在 Apple 芯片 Mac，可为 Apple「照片」生成 `.pvt`，也可为兼容 Google Motion Photo 1.0 的 Android 相册生成 `MP.jpg`。Android 指的是**输出格式**，运行转换命令的设备仍是 Mac。

## 转换链路

~~~text
MP4 / GIF → ffprobe 读取视频轨和时长 → FFmpeg 转换片段和抽取封面
                                           ├─ Apple  JPG + MOV + plist → .pvt
                                           └─ Android  JPG 加 XMP + MP4 → MP.jpg
~~~

[CLI 入口](../src/stillish/cli.py) 默认从第 0 秒转换到原片末尾。FFmpeg 将画面整理成 30 fps、H.264、方形像素的视频，按输入显示方向处理，输出宽高取偶数。存在音轨时选第一条，编码为 AAC。封面从**转换后的视频**抽取，默认取中间帧。指定 `--cover` 时，时间相对于所截片段，并就近对齐到实际输出帧。封面和两种格式的时间标记共用同一个帧编号。 [FFmpeg 命令行文档](https://ffmpeg.org/ffmpeg.html) · [ffprobe 文档](https://ffmpeg.org/ffprobe.html)

GIF 通过 FFmpeg 读取一轮，帧间停留时间按 GIF 时间戳转换为 30 fps。先转换帧率，再截取并将片段时间归零，因此可以从某帧的停留区间中间开始截取。透明区域在解码时填白，单帧 GIF 会被拒绝。 [FFmpeg GIF 读取选项](https://ffmpeg.org/ffmpeg-formats.html#gif) · [FFmpeg fps 滤镜](https://ffmpeg.org/ffmpeg-filters.html#fps)

CLI 在目标目录内创建临时目录。成品生成后再发布。macOS 使用排他重命名保护同名成品，转换失败时临时目录随退出清理。

## Apple Live Photo 与 .pvt

FFmpeg 先把处理后的音视频流原样重封装进 MOV。Stillish 为每张实况照生成一个 UUID，把它写入 JPG EXIF MakerNote 的 tag 17 和 MOV 的 `com.apple.quicktime.content.identifier`。MOV 里的 `mebx` 定时元数据轨承载 `com.apple.quicktime.still-image-time`，由该样本的播放位置标出封面对应时刻。封装前会读回检查配对 ID 和封面时刻。 [写入与读回实现](../src/stillish/apple/metadata.py) · [Apple 定时元数据 API](https://developer.apple.com/documentation/avfoundation/avassetwriter) · [Apple 配对视频资源](https://developer.apple.com/documentation/photos/phassetresourcetype/pairedvideo)

~~~text
demo.pvt/
├── demo.jpg
├── demo.mov
└── metadata.plist
~~~

`metadata.plist` 写入 `PFVideoComplementMetadataVersionKey`，值为字符串 `1`。Finder 把这个包目录显示为一个项目。Apple 官方文档定义了配对资源的读取与保存方式，项目的 `.pvt` 包目录结构参考了开源打包实现。 [Stillish 封装代码](../src/stillish/formats.py) · [MakeLive 打包实现](https://github.com/RhetTbull/makelive/blob/main/makelive/makelive.py) · [Apple PhotoKit 创建资源接口](https://developer.apple.com/documentation/photos/phassetcreationrequest)

JPEG 和 MOV 配对代码来自 LiveCanvas 所用的 Python 实现，原项目为杨振的 `video-to-live-photo`。仓库保留了对应的 Apache-2.0 许可、作者署名及参考提交。 [LiveCanvas 固定参考提交](https://github.com/pengchujin/livecanvas/tree/168e1461059105d091ba0df666703c63ccbaaa5c/livecanvas/scripts/portable_live_photo) · [原项目](https://github.com/yangzhen-23/video-to-live-photo) · [本地署名](../src/stillish/licenses/NOTICE.txt)

## Android Motion Photo

~~~text
[SOI][JFIF APP0][XMP APP1][其余 JPEG 字节][EOI FF D9][完整 MP4]
~~~

Stillish 保留 JPEG 的 JFIF APP0，在 APP1 写入 Motion Photo XMP。元数据包括动图标记、版本号、以微秒表示的封面时刻，以及 `Primary`、`MotionPhoto` 两项的媒体目录。目录记录 MP4 的实际字节数。读取方从文件末尾按这个长度回退，就能定位内嵌 MP4。普通 JPEG 解码仍可显示静态封面。输出名采用规范建议的 `MP.jpg` 后缀。 [Android 官方格式规范](https://developer.android.com/media/platform/motion-photo-format) · [Stillish 封装代码](../src/stillish/formats.py)

这一路径实现 Google Motion Photo 1.0 的 JPEG 封装。厂商相册以及小红书发布页的识别情况按设备、系统和 App 版本实测记录。 [小米动态照片兼容说明](https://dev.mi.com/xiaomihyperos/livephoto)

## 打包、依赖与传输

- PyInstaller 用 `--onefile` 把 Python 和库嵌入 `stillish`。启动时展开到临时目录，正常退出后清理。媒体工具优先从 `PATH` 查找，其次使用 `~/Library/Caches/stillish/`。Apple 芯片 Mac 首次缺依赖时下载固定版本的 FFmpeg 和 ffprobe，比较 SHA-256 并检查所需编码器。 [构建脚本](../scripts/build-macos.sh) · [依赖检测实现](../src/stillish/dependencies.py) · [PyInstaller 单文件说明](https://pyinstaller.org/en/stable/operating-mode.html#bundling-to-one-file) · [依赖发行包和校验值](https://github.com/vanloctech/ffmpeg-macos/releases/expanded_assets/ffmpeg-2026.06.11)
- 微信传输时，将整个 `.pvt` 包目录或原始 `MP.jpg` 压缩成 ZIP，当文件发送。接收方先解压，再用相册导入或查看。ZIP 保留包目录和 JPEG 尾部的 MP4。图片通道若重写 JPEG，可能只留下封面。仅凭聊天预览无法确定手机收到的文件是否被重写。 [Android 格式的读取要求](https://developer.android.com/media/platform/motion-photo-format)

## 验证记录

| 检查 | 已获得的结果 |
| --- | --- |
| 本地回归 | 10 项测试通过。MP4 样片覆盖时长、音轨、封面、Apple 配对和 Android XMP。合成 GIF 覆盖单轮帧时序、透明区域填白、从帧停留区间截取、单帧和损坏文件。 |
| GIF 样片 | 61 帧 GIF 单轮 5.08 秒。ARM64 单文件生成的两种成品均为 152 帧、5.067 秒，封面与 2.533 秒处的视频帧一致。Apple 成品经 PhotoKit 加载成功，Android 成品的 XMP、内嵌视频和解码通过本机校验。 |
| Apple 配对 | 两档测试样片和用户提供的 5.63 秒无声样片均通过 PhotoKit 资源加载，识别到配对视频。Mac「照片」界面导入未实测。 |
| Android 传输 | 用户反馈，5.63 秒样片直接在微信聊天中显示为静态；将 ZIP 当文件传到 Android、解压后，相册识别为实况。机型、相册名称与版本未记录。打包前后对比确认 ZIP 解压得到的 JPG 与本地原件逐字节一致。 |
| 首次补齐 FFmpeg | 已校验发行归档的 SHA-256，并用真实归档本地回放补齐流程。单文件程序实际通过了系统工具复用和缓存离线复用。公网直接下载的那次测试因速度慢而取消。 |
| 小红书与 Windows | 小红书发布预览、10 秒实际播放时长和 Windows 运行均待实测。 |

复验命令见 [AGENTS.md](../AGENTS.md)。本地回归通过后，再分别记录相册导入、实际播放和小红书预览的结果。用户样片的转换产物留在本机的忽略目录 `dist/`。
