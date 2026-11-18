# AGENTS.md

照样动 · Stillish 是把 MP4 和 GIF 转为实况照片的本地 CLI。面向用户的说明见 [README.md](README.md)。首份发行物是 Apple 芯片 Mac 的单个可执行文件。

## 修改约定

- `src/stillish/cli.py` 负责参数、共享 FFmpeg 转换和输出事务。`formats.py` 负责 Apple 与 Android 封装。`dependencies.py` 负责外部工具检测、下载校验和缓存。
- MP4 和 GIF 默认输出 Apple Live Photo。Android 通过 `--target android` 指定。成功时在标准输出仅打印成品路径，诊断和进度写入标准错误。
- 源文件保持只读。使用输出目录下的临时目录生成资源，完成后再发布成品，并防止覆盖同名文件。
- Apple 的 JPEG MakerNote、MOV 内容标识和定时元数据轨必须一致，时间指向实际封面帧。先重封装再写元数据，后续普通转码会丢掉定时轨。保留 `src/stillish/licenses/` 中的第三方许可和署名。
- Android JPEG 保留 JFIF APP0，将 Motion Photo XMP 写入 APP1。XMP 记录实际视频长度和封面时间，完整 MP4 放在 JPEG 结束标记后。
- 更新下载源时同时更新版本和 SHA-256，复验系统工具优先、首次补齐、下载失败清理和缓存离线运行。分开记录格式校验、相册导入播放和小红书发布预览。

## 构建与验收

在 Apple 芯片 Mac 上使用 Python 3.12，测试机的 `PATH` 需要提供 FFmpeg 和 ffprobe。

~~~sh
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[build]'
PYTHONPATH=src python -m unittest discover -s tests -v
sh -n scripts/build-macos.sh
./scripts/build-macos.sh
~~~

打包后从 `dist/stillish` 验证真实入口。需要复验 Apple 配对资源时，可用 Xcode 命令行工具构建不写入图库的测试程序：

~~~sh
mkdir -p build
xcrun clang -fobjc-arc -fblocks -framework AppKit -framework Photos \
  tests/verify_apple.m -o build/verify-apple
build/verify-apple /path/to/demo.pvt/demo.jpg /path/to/demo.pvt/demo.mov
~~~

使用 3 秒无声和 10 秒有声两档样片验证封面时刻、时长及音轨。用不等帧时长的 GIF 验证循环、截取和透明区域。完成实际设备验证时，在 [技术说明](docs/TECHNICAL.md)中记录系统、客户端版本和实测结果。开发与验收结束后再按最终实现更新这些文档。成品及用户样片留在本机 `dist/`。

## 发布新版本

在 `pyproject.toml` 中更新版本并将提交合入 `main`。切到该提交，创建并推送与项目版本匹配的标签，将命令中的 `vX.Y.Z` 替换为实际标签。

~~~sh
git tag vX.Y.Z
git push origin refs/tags/vX.Y.Z
~~~

[发布工作流](.github/workflows/release.yml)验证后会把 `stillish-macos-arm64` 和 `SHA256SUMS.txt` 上传到对应的 GitHub Release。下载这两个文件到同一目录，运行 `shasum -a 256 -c SHA256SUMS.txt`。
