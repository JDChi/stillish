export const utf8 = new TextEncoder();
export const text = new TextDecoder();

export function joinBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function words(...values: number[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(values.length * 4);
  const view = dataView(result);
  for (const [index, value] of values.entries()) {
    view.setUint32(index * 4, value);
  }
  return result;
}

export function shorts(...values: number[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(values.length * 2);
  const view = dataView(result);
  for (const [index, value] of values.entries()) {
    view.setUint16(index * 2, value);
  }
  return result;
}

export function matches(bytes: Uint8Array, offset: number, value: Uint8Array): boolean {
  return value.length <= bytes.length - offset
    && value.every((byte, index) => bytes[offset + index] === byte);
}
