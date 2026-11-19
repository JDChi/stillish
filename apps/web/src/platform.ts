export type PhotoFormat = "apple" | "android";

interface DeviceInfo {
  userAgent: string;
  platform: string;
  userAgentData?: { platform?: string };
}

export function photoFormat(device: DeviceInfo): PhotoFormat {
  const { userAgent, platform, userAgentData } = device;
  const platforms = [userAgentData?.platform, platform, userAgent].join(" ");
  if (/\b(?:android|windows|win32|win64)\b/i.test(platforms)) return "android";
  return /\b(?:mac(?:intel|ppc|68k|intosh|os)?|iphone|ipad|ipod)\b/i.test(platforms) ? "apple" : "android";
}
