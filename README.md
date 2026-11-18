# 照样动 · Stillish

Stillish 在本地把一段 MP4 转成 Apple 实况照片或 Android Motion Photo。首个可执行文件面向 Apple 芯片 Mac，内置 Python 运行时。

[技术说明](docs/TECHNICAL.md)记录了转换流程、文件结构、验证结果和参考来源。

## 转换

把可执行文件和输入视频放在终端可访问的位置，然后运行：

~~~sh
./stillish demo.mp4
./stillish demo.mp4 --target android
./stillish demo.mp4 --start 2 --duration 3 --cover 1 --out ./out
~~~

默认从第 0 秒开始保留完整视频，使用中间帧做封面，成品写入当前目录。时间参数以秒为单位，`--cover` 相对于截取后的片段。已有同名成品时命令会提示。运行 `./stillish --help` 可查看所有参数。

- **Apple** 生成 `demo.pvt`。在 Mac「照片」中导入整个包，再从「照片」通过 AirDrop 或 iCloud 照片把实况照片传到 iPhone。
- **Android** 生成 `demoMP.jpg`。将原始文件传到目标手机，用支持 Google Motion Photo 的相册打开，例如 Android 上的 Google Photos。厂商原生相册和小红书的识别取决于设备及应用版本。 [Android Motion Photo 规范](https://developer.android.com/media/platform/motion-photo-format)

Stillish 把视频转为 30 fps H.264。有音轨时保留第一条音轨并编码为 AAC。命令成功时在标准输出打印成品路径。

## 首次运行

Stillish 优先使用 `PATH` 里可用的 `ffmpeg` 和 `ffprobe`，其次使用 `~/Library/Caches/stillish/` 的缓存。首次缺少依赖时，Apple 芯片 Mac 会下载约 33 MB 的固定版本，验证 SHA-256 后继续转换。媒体素材始终在本地处理。缓存完成后可离线转换。 [FFmpeg 发行包与 SHA-256](https://github.com/vanloctech/ffmpeg-macos/releases/expanded_assets/ffmpeg-2026.06.11)

若下载失败，命令会显示原因。可以重试，或将支持 H.264、AAC 和 JPEG 编码的 `ffmpeg`、`ffprobe` 放入 `PATH`。

## 验证范围

- 在 Apple 芯片 Mac 上运行了单文件程序，验证系统依赖复用、持久缓存离线复用和下载失败清理。使用校验过的真实发行归档，从本地回放了首次下载、校验和解包流程。
- 3 秒无声与 10 秒有声 MP4 的两种输出均通过静态配对和音视频解码检查。macOS PhotoKit 加载了对应的 Apple 资源，识别到配对视频。
- 用户已确认，Android 样片经微信发送 ZIP、解压后可被相册识别为实况。机型、相册及版本未记录。
- Mac「照片」界面导入、小红书发布预览和 Android Google Photos 专项兼容性待实测。
