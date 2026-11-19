// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 杨振
// Adapted from LiveCanvas, including its timed track and chunk-offset fixes.
import { canonicalAssetId } from "./apple-jpeg";
import { dataView, joinBytes, matches, shorts, text, utf8, words } from "./bytes";
import { atom, atomHeader, children, firstChild, parseAtoms, patchChunkOffsets, requireChild, type Atom } from "./iso-bmff";

const CONTENT_KEY = utf8.encode("com.apple.quicktime.content.identifier");
const STILL_TIME_KEY = utf8.encode("com.apple.quicktime.still-image-time");
const TIMED_SAMPLE = Uint8Array.of(0, 0, 0, 9, 0, 0, 0, 1, 0);
const MAX_U32 = 0xffffffff;

function pascal(value: string): Uint8Array {
  const bytes = utf8.encode(value);
  return joinBytes(Uint8Array.of(bytes.length), bytes);
}

function contentKeyRecord(): Uint8Array {
  return joinBytes(words(0, 1, 8 + CONTENT_KEY.length), utf8.encode("mdta"), CONTENT_KEY);
}

function identifierMetadata(assetId: string): Uint8Array {
  const handler = atom("hdlr", words(0, 0), utf8.encode("mdta"), new Uint8Array(14));
  const keys = atom("keys", contentKeyRecord());
  const value = atom("data", words(1, 0), utf8.encode(assetId));
  return atom("meta", handler, keys, atom("ilst", atom("\0\0\0\x01", value)));
}

function timedTrack(
  trackId: number, videoTrackId: number, timescale: number,
  coverTicks: number, sampleOffset: number, sampleTicks: number,
): Uint8Array {
  const trackDuration = coverTicks + sampleTicks;
  if (trackDuration > MAX_U32) throw new Error("MOV 封面时间超出轨道长度限制");
  const matrix = words(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
  const tkhd = atom("tkhd", words(15, 0, 0, trackId, 0, trackDuration), new Uint8Array(16), matrix, words(0, 0));

  const edits = [];
  if (coverTicks) edits.push(words(coverTicks, MAX_U32, 0x10000));
  edits.push(words(sampleTicks, 0, 0x10000));
  const edts = atom("edts", atom("elst", words(0, edits.length), ...edits));
  const tref = atom("tref", atom("cdsc", words(videoTrackId)));

  const mdhd = atom("mdhd", words(0, 0, 0, timescale, sampleTicks), shorts(0x55c4, 0));
  const hdlr = atom("hdlr", words(0), utf8.encode("mhlrmetaappl"), words(1, 0), pascal("Core Media Metadata"));
  const gmhd = atom("gmhd", atom("gmin", words(0), shorts(0x0040, 0x8000, 0x8000, 0x8000, 0, 0)));
  const dataHandler = atom("hdlr", words(0), utf8.encode("dhlralisappl"), words(0, 0), pascal("Core Media Data Handler"));
  const dinf = atom("dinf", atom("dref", words(0, 1), atom("alis", words(1))));

  const key = atom("keyd", utf8.encode("mdta"), STILL_TIME_KEY);
  const type = atom("dtyp", words(0, 0x41));
  const keys = atom("keys", words(8 + key.length + type.length, 1), key, type);
  const mebx = atom("mebx", new Uint8Array(6), shorts(1), keys);
  const stsd = atom("stsd", words(0, 1), mebx);
  const stts = atom("stts", words(0, 1, 1, sampleTicks));
  const stsc = atom("stsc", words(0, 1, 1, 1, 1));
  const stsz = atom("stsz", words(0, 0, 1, TIMED_SAMPLE.length));
  let chunkOffsets = atom("stco", words(0, 1, sampleOffset));
  if (sampleOffset > MAX_U32) {
    const offset = new Uint8Array(8);
    dataView(offset).setBigUint64(0, BigInt(sampleOffset));
    chunkOffsets = atom("co64", words(0, 1), offset);
  }
  const stbl = atom("stbl", stsd, stts, stsc, stsz, chunkOffsets);
  const minf = atom("minf", gmhd, dataHandler, dinf, stbl);
  return atom("trak", tkhd, edts, tref, atom("mdia", mdhd, hdlr, minf));
}

function versionedField(data: Uint8Array, box: Atom): number {
  const position = box.payload + (data[box.payload] === 1 ? 20 : 12);
  if (position + 4 > box.end) throw new Error("MOV " + box.type + " 不完整");
  return dataView(data).getUint32(position);
}

function timescaleOf(data: Uint8Array, moov: Atom): number {
  const timescale = versionedField(data, requireChild(data, moov, "mvhd"));
  if (!timescale) throw new Error("MOV 时间基无效");
  return timescale;
}

function trackIdOf(data: Uint8Array, track: Atom): number {
  return versionedField(data, requireChild(data, track, "tkhd"));
}

function handlerOf(data: Uint8Array, track: Atom): string | undefined {
  const mdia = firstChild(data, track, "mdia");
  const hdlr = mdia && firstChild(data, mdia, "hdlr");
  if (hdlr && hdlr.payload + 12 <= hdlr.end) return text.decode(data.subarray(hdlr.payload + 8, hdlr.payload + 12));
}

function movieAtoms(data: Uint8Array) {
  const top = parseAtoms(data);
  const mdat = top.find((item) => item.type === "mdat");
  const moov = top.find((item) => item.type === "moov");
  if (!mdat || !moov || !top.some((item) => item.type === "ftyp")) {
    throw new Error("MOV 必须包含 ftyp、mdat 和 moov");
  }
  return { top, mdat, moov };
}

export function writeAppleMov(
  data: Uint8Array, assetId: string, stillTime: number, duration: number, fps: number,
): Uint8Array {
  const identifier = canonicalAssetId(assetId);
  if (!(duration > 0 && stillTime >= 0 && stillTime <= duration)) {
    throw new Error("Apple 封面时刻必须位于视频片段内");
  }
  const { top, mdat, moov } = movieAtoms(data);
  if (top.filter((item) => item.type === "mdat").length !== 1 || top.some((item) => item.type === "moof")) {
    throw new Error("Expected non-fragmented, single-mdat FFmpeg output");
  }
  const timescale = timescaleOf(data, moov);
  const tracks = children(data, moov).filter((item) => item.type === "trak");
  const video = tracks.find((item) => handlerOf(data, item) === "vide");
  if (!video) throw new Error("MOV 中没有可关联的视频轨");
  const videoTrackId = trackIdOf(data, video);
  const metadataTrackId = Math.max(...tracks.map((track) => trackIdOf(data, track))) + 1;
  const coverTicks = Math.min(Math.round(stillTime * timescale), Math.max(0, Math.round(duration * timescale) - 1));

  const prefix = top.filter((item) => item.type !== "mdat" && item.type !== "moov")
    .map((item) => data.subarray(item.start, item.end));
  const media = data.subarray(mdat.payload, mdat.end);
  const mdatHeader = atomHeader("mdat", media.length + TIMED_SAMPLE.length);
  const mediaStart = prefix.reduce((size, bytes) => size + bytes.length, mdatHeader.length);
  const patched = patchChunkOffsets(data.subarray(moov.start, moov.end), mediaStart - mdat.payload);

  const [patchedMoov] = parseAtoms(patched);
  const mvhd = requireChild(patched, patchedMoov, "mvhd");
  dataView(patched).setUint32(mvhd.end - 4, metadataTrackId + 1);
  const newMoov = atom(
    "moov", patched.subarray(patchedMoov.payload, patchedMoov.end), identifierMetadata(identifier),
    timedTrack(metadataTrackId, videoTrackId, timescale, coverTicks, mediaStart + media.length,
      Math.max(1, Math.round(timescale / fps))),
  );
  return joinBytes(...prefix, mdatHeader, media, TIMED_SAMPLE, newMoov);
}

function chunkOffsetOf(data: Uint8Array, track: Atom): number {
  const mdia = requireChild(data, track, "mdia");
  const stbl = requireChild(data, requireChild(data, mdia, "minf"), "stbl");
  const table = firstChild(data, stbl, "stco") ?? requireChild(data, stbl, "co64");
  const view = dataView(data);
  const width = table.type === "stco" ? 4 : 8;
  if (table.payload + 8 + width > table.end || view.getUint32(table.payload + 4) < 1) {
    throw new Error("MOV chunk offset 表不完整");
  }
  return table.type === "stco" ? view.getUint32(table.payload + 8) : Number(view.getBigUint64(table.payload + 8));
}

function coverTicksOf(data: Uint8Array, track: Atom): number {
  const edits = firstChild(data, track, "edts");
  const elst = edits && firstChild(data, edits, "elst");
  if (!elst || dataView(data).getUint32(elst.payload + 4) < 2) return 0;
  const view = dataView(data);
  const position = elst.payload + 8;
  if (data[elst.payload] === 0) {
    return view.getInt32(position + 4) === -1 ? view.getUint32(position) : 0;
  }
  return view.getBigInt64(position + 8) === -1n ? Number(view.getBigUint64(position)) : 0;
}

export function readAppleMov(data: Uint8Array): { assetId: string; stillTime: number; sampleValue: number } {
  const { moov } = movieAtoms(data);
  const timescale = timescaleOf(data, moov);
  const boxes = children(data, moov);
  const identifiers: string[] = [];
  const expectedKeys = contentKeyRecord();
  for (const box of boxes.filter((item) => item.type === "meta")) {
    const keys = firstChild(data, box, "keys");
    const list = firstChild(data, box, "ilst");
    if (!keys || !list || keys.end - keys.payload !== expectedKeys.length || !matches(data, keys.payload, expectedKeys)) continue;
    const entry = firstChild(data, list, "\0\0\0\x01");
    const value = entry && firstChild(data, entry, "data");
    if (value && matches(data, value.payload, words(1, 0))) {
      identifiers.push(canonicalAssetId(text.decode(data.subarray(value.payload + 8, value.end))));
    }
  }
  if (identifiers.length !== 1) throw new Error("MOV 必须包含一个配对标识");

  const tracks = boxes.filter((item) => item.type === "trak");
  const video = tracks.find((track) => handlerOf(data, track) === "vide");
  const metadata = tracks.find((track) => handlerOf(data, track) === "meta"
    && text.decode(data.subarray(track.payload, track.end)).includes(text.decode(STILL_TIME_KEY)));
  if (!video || !metadata) throw new Error("MOV 缺少视频轨或 still-image-time 元数据轨");
  const offset = chunkOffsetOf(data, metadata);
  if (offset + TIMED_SAMPLE.length > data.length || !matches(data, offset, TIMED_SAMPLE.subarray(0, 8))) {
    throw new Error("MOV still-image-time sample 结构无效");
  }
  return {
    assetId: identifiers[0],
    stillTime: coverTicksOf(data, metadata) / timescale,
    sampleValue: dataView(data).getInt8(offset + 8),
  };
}
