// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 杨振
// Adapted from the LiveCanvas Apple MakerNote and ExifIFD layout.
import { dataView, joinBytes, matches, shorts, text, utf8, words } from "./bytes";
import { jpegSegment } from "./jpeg";

const EXIF = utf8.encode("Exif\0\0");
const MAKER_HEADER = utf8.encode("Apple iOS\0\0\x01MM");
const MAKE = utf8.encode("Apple\0");
const MODEL = utf8.encode("Stillish\0");

export function canonicalAssetId(value: string): string {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Apple 资产标识必须是标准 UUID");
  }
  return value.toUpperCase();
}

function makerNote(assetId: string): Uint8Array {
  const identifier = utf8.encode(canonicalAssetId(assetId) + "\0");
  return joinBytes(MAKER_HEADER, shorts(1, 0x11, 2), words(identifier.length, 32, 0), identifier);
}

function entry(tag: number, kind: number, count: number, value: number | Uint8Array): Uint8Array {
  return joinBytes(shorts(tag, kind), words(count), typeof value === "number" ? words(value) : value);
}

function directory(...entries: Uint8Array[]): Uint8Array {
  return joinBytes(shorts(entries.length), ...entries, words(0));
}

export function writeAppleJpeg(jpeg: Uint8Array, assetId: string, width: number, height: number): Uint8Array {
  const note = makerNote(assetId);
  const exifOffset = 8 + 2 + 3 * 12 + 4;
  const dataOffset = exifOffset + 2 + 6 * 12 + 4;
  const modelOffset = dataOffset + MAKE.length;
  const root = directory(
    entry(0x010f, 2, MAKE.length, dataOffset),
    entry(0x0110, 2, MODEL.length, modelOffset),
    entry(0x8769, 4, 1, exifOffset),
  );
  const exif = directory(
    entry(0x9000, 7, 4, utf8.encode("0232")),
    entry(0x927c, 7, note.length, modelOffset + MODEL.length),
    entry(0xa000, 7, 4, utf8.encode("0100")),
    entry(0xa001, 3, 1, shorts(1, 0)),
    entry(0xa002, 4, 1, width),
    entry(0xa003, 4, 1, height),
  );
  const tiff = joinBytes(utf8.encode("MM"), shorts(42), words(8), root, exif, MAKE, MODEL, note);
  return jpegSegment(jpeg, joinBytes(EXIF, tiff));
}

export function readAppleJpeg(jpeg: Uint8Array): string {
  const view = dataView(jpeg);
  let offset = 2;
  if (view.getUint16(offset) === 0xffe0) offset += 2 + view.getUint16(offset + 2);
  if (view.getUint16(offset) !== 0xffe1 || !matches(jpeg, offset + 4, EXIF)) {
    throw new Error("JPEG 缺少 Apple EXIF");
  }
  const segmentEnd = offset + 2 + view.getUint16(offset + 2);
  const tiff = dataView(jpeg.subarray(offset + 4 + EXIF.length, segmentEnd));

  function findEntry(directoryOffset: number, tag: number): number {
    const count = tiff.getUint16(directoryOffset);
    for (let index = 0; index < count; index++) {
      const position = directoryOffset + 2 + 12 * index;
      if (tiff.getUint16(position) === tag) return position;
    }
    throw new Error("JPEG 缺少 Apple MakerNote");
  }

  const pointer = findEntry(tiff.getUint32(4), 0x8769);
  const maker = findEntry(tiff.getUint32(pointer + 8), 0x927c);
  const start = tiff.getUint32(maker + 8);
  const note = new Uint8Array(tiff.buffer, tiff.byteOffset + start, tiff.getUint32(maker + 4));
  const noteView = dataView(note);
  if (tiff.getUint16(maker + 2) !== 7 || !matches(note, 0, MAKER_HEADER)
      || noteView.getUint16(16) !== 17 || noteView.getUint16(18) !== 2) {
    throw new Error("Apple MakerNote 内容标识无效");
  }
  const idStart = noteView.getUint32(24);
  return canonicalAssetId(text.decode(note.subarray(idStart, idStart + noteView.getUint32(20) - 1)));
}
