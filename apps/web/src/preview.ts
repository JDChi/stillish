export async function drawPreview(file: File, canvas: HTMLCanvasElement, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const source = URL.createObjectURL(file);
  const media = /\.gif$/i.test(file.name) ? new Image() : document.createElement("video");
  const video = media instanceof HTMLVideoElement ? media : undefined;
  if (video) {
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
  }
  const listeners = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frameRequest: number | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      const unavailable = () => reject(new Error("无法读取预览画面。"));
      const options = { once: true, signal: listeners.signal };
      if (video) {
        // On WebKit, the decoded frame can arrive after the seeked event.
        if (video.requestVideoFrameCallback) {
          frameRequest = video.requestVideoFrameCallback(() => resolve());
        } else {
          video.addEventListener("seeked", () => resolve(), options);
        }
        video.addEventListener("loadedmetadata", () => {
          if (video.duration > 0) {
            try {
              video.currentTime = Math.min(0.12, video.duration / 2);
            } catch {
              unavailable();
            }
          } else if (frameRequest === undefined) {
            video.addEventListener("loadeddata", () => resolve(), options);
          }
        }, options);
      } else {
        media.addEventListener("load", () => resolve(), options);
      }
      media.addEventListener("error", unavailable, options);
      signal.addEventListener("abort", () => reject(signal.reason), options);
      timer = setTimeout(unavailable, 5000);
      media.src = source;
    });
    signal.throwIfAborted();
    const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
    const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
    if (!width || !height) throw new Error("预览画面没有有效尺寸。");

    const scale = Math.min(1, 248 / width, 186 / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法绘制预览。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(media, 0, 0, canvas.width, canvas.height);
  } finally {
    clearTimeout(timer);
    listeners.abort();
    if (frameRequest !== undefined) video?.cancelVideoFrameCallback(frameRequest);
    media.removeAttribute("src");
    video?.load();
    URL.revokeObjectURL(source);
  }
}
