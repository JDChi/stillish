<h1 align="center">Stillish</h1>

<p align="center"><a href="README.zh-CN.md">简体中文</a></p>

<p align="center"><strong>Turn MP4 videos into motion photos you can play in your phone's gallery.</strong></p>

<p align="center">
  Local CLI for Apple silicon Macs · Apple Live Photos and Android Motion Photos
</p>

Stillish turns screen recordings, animations, and everyday clips into moving photos. It picks a cover frame and keeps the first audio track when present.

## Download and convert

Download `stillish` on an Apple silicon Mac. Open Terminal in your downloads folder and replace `demo.mp4` with the path to your video. [Download Stillish](https://github.com/JDChi/stillish/releases/latest/download/stillish)

```sh
chmod +x stillish
./stillish demo.mp4
```

| Where to open it | Command | Result |
| --- | --- | --- |
| Apple Photos | `./stillish demo.mp4` | `demo.pvt`. Import it into Photos on your Mac, then use AirDrop or iCloud Photos to get it onto your iPhone. |
| Android gallery with Motion Photo support | `./stillish demo.mp4 --target android` | `demoMP.jpg`. Transfer the file as-is and open it in your gallery. |

By default, Stillish keeps the full video and uses its middle frame as the cover. You can also trim the clip and choose a cover frame.

```sh
./stillish demo.mp4 --start 2 --duration 3 --cover 1 --out ./out
```

This takes a 3-second clip starting 2 seconds into the video and uses the frame 1 second into the clip as the cover. Files go to your current folder by default. Stillish warns you if a file with the same name already exists. Run `./stillish --help` for all options.

> **Sharing via WeChat.** Put the `.pvt` or `MP.jpg` in a ZIP archive and send it as a file. On Android, unzip it in the file manager and open the photo in your gallery. For Apple Photos, unzip the package on your Mac and import it into Photos.

Videos are processed on your Mac. If FFmpeg is missing, Stillish downloads it on the first conversion (about 33 MB).
