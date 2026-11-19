import { dataView, joinBytes, shorts } from "./bytes";

export function jpegSegment(jpeg: Uint8Array, payload: Uint8Array): Uint8Array {
  const view = dataView(jpeg);
  if (jpeg.length < 4 || view.getUint16(0) !== 0xffd8) throw new Error("实况封面不是有效的 JPEG");
  let offset = 2;
  if (view.getUint16(offset) === 0xffe0) {
    if (jpeg.length < 6) throw new Error("实况封面的 JPEG 段无效");
    const size = view.getUint16(4);
    offset = 4 + size;
    if (size < 2 || offset > jpeg.length) throw new Error("实况封面的 JPEG 段无效");
  }
  if (payload.length + 2 > 0xffff) throw new Error("JPEG APP1 段超出长度限制");
  return joinBytes(jpeg.subarray(0, offset), shorts(0xffe1, payload.length + 2), payload, jpeg.subarray(offset));
}
