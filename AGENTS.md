# AGENTS.md

照样动 · Stillish 是把 MP4 和 GIF 转为实况照片的本地 CLI。面向用户的说明见 [README.md](README.md)。发行物是 Apple 芯片 Mac 的单个可执行文件。

## 修改约定

- [CLI](apps/cli/) 负责命令行参数、本地文件、FFmpeg 进程和依赖下载。[公共库](packages/core/) 负责转换参数、封面计算和封装，使用普通 TypeScript 和字节数据，供 CLI 和未来的浏览器入口共用。
- MP4 和 GIF 默认输出 Apple Live Photo。Android 通过 `--target android` 指定。成功时在标准输出仅打印成品路径，诊断和进度写入标准错误。
- 源文件保持只读。使用输出目录下的临时目录生成资源，完成后再发布成品，并防止覆盖同名文件。
- Apple 的 JPEG MakerNote、MOV 内容标识和定时元数据轨必须一致，时间指向实际封面帧。先重封装再写元数据，后续普通转码会丢掉定时轨。保留 [第三方许可和署名](packages/core/licenses/)，通过 `stillish --license` 随单文件交付。
- Android JPEG 保留 JFIF APP0，将 Motion Photo XMP 写入 APP1。XMP 记录实际视频长度和封面时间，完整 MP4 放在 JPEG 结束标记后。
- 更新下载源时同时更新版本和 SHA-256，复验系统工具优先、首次补齐、下载失败清理和缓存离线运行。分开记录格式校验、相册导入播放和小红书发布预览。

## 构建与验收

在 Apple 芯片 Mac 上使用根目录 `package.json` 指定的 Bun 版本。测试机的 `PATH` 需要提供 FFmpeg 和 ffprobe。

~~~sh
bun install --frozen-lockfile
bun run check
bun run test
bun run test:browser
sh -n apps/cli/scripts/build-macos.sh
bun run build:cli
STILLISH_TEST_BINARY=apps/cli/dist/stillish bun test apps/cli/tests/cli.test.ts
~~~

公共库测试覆盖两种格式的字节结构，并用浏览器目标打包后在只提供 Web API 的环境中运行。验证真实依赖归档的空缓存安装和离线复用时，将 `STILLISH_TEST_FFMPEG_ARCHIVE` 指向已下载的固定版本归档后运行测试。

需要复验 Apple 配对资源时，用 Xcode 命令行工具构建不写入图库的测试程序。

~~~sh
mkdir -p apps/cli/dist
xcrun clang -fobjc-arc -fblocks -framework AppKit -framework Photos \
  apps/cli/tests/verify_apple.m -o apps/cli/dist/verify-apple
apps/cli/dist/verify-apple /path/to/demo.pvt/demo.jpg /path/to/demo.pvt/demo.mov
~~~

用 3 秒无声和 10 秒有声的 MP4、不等帧时长的 GIF 验证封面、时长、音轨、循环和透明区域。实际设备验收记录在 [技术说明](docs/TECHNICAL.md)。构建产物写入 `apps/cli/dist/`，用户样片留在本机。

## 发布新版本

在根目录 `package.json` 中更新版本并将提交合入 `main`。切到该提交，创建并推送与项目版本匹配的标签，将命令中的 `vX.Y.Z` 替换为实际标签。

~~~sh
git tag vX.Y.Z
git push origin refs/tags/vX.Y.Z
~~~

[发布工作流](.github/workflows/release.yml)验证后会从 `apps/cli/dist/` 上传 `stillish-macos-arm64` 和 `SHA256SUMS.txt`。下载这两个文件到同一目录，运行 `shasum -a 256 -c SHA256SUMS.txt`。
