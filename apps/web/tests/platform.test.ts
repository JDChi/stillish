import { expect, test } from "bun:test";
import { photoFormat } from "../src/platform";

test("chooses one photo format from the browser's device information", () => {
  const devices = [
    [{ platform: "MacIntel", userAgent: "Macintosh; Intel Mac OS X 10_15_7" }, "apple"],
    [{ platform: "iPhone", userAgent: "iPhone; CPU iPhone OS 18_0 like Mac OS X" }, "apple"],
    [{ platform: "MacIntel", userAgent: "Macintosh; Intel Mac OS X", maxTouchPoints: 5 }, "apple"],
    [{ platform: "", userAgent: "iPad; CPU OS 18_0 like Mac OS X" }, "apple"],
    [{ platform: "Linux armv8l", userAgent: "Linux; Android 14; Pixel 8" }, "android"],
    [{ platform: "Win32", userAgent: "Windows NT 10.0; Win64; x64" }, "android"],
    [{ platform: "", userAgent: "", userAgentData: { platform: "macOS" } }, "apple"],
    [{ platform: "", userAgent: "" }, "android"],
  ] as const;

  for (const [device, format] of devices) expect(photoFormat(device)).toBe(format);
});
