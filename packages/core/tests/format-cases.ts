import { dataView, joinBytes, matches, utf8, words } from "../src/bytes";
import { readAppleJpeg } from "../src/apple-jpeg";
import { readAppleMov } from "../src/apple-mov";
import { buildAndroidJpeg, buildApplePhoto } from "../src/formats";
import { atom, parseAtoms, requireChild } from "../src/iso-bmff";
import { selectCover } from "../src/conversion";

const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xd9);
const SAMPLE = Uint8Array.of(1, 2, 3, 4);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Minimal unpaired MOV with moov before mdat, forcing an actual chunk-offset adjustment.
function unpairedMovie(): Uint8Array {
  const ftyp = atom("ftyp", utf8.encode("qt  "));
  const mdat = atom("mdat", SAMPLE);
  const moov = (offset: number) => atom("moov", atom("mvhd", words(0, 0, 0, 60000, 90000, 2)),
    atom("trak", atom("tkhd", words(0, 0, 0, 1)), atom("mdia", atom("hdlr", words(0, 0), utf8.encode("vide")),
      atom("minf", atom("stbl", atom("stco", words(0, 1, offset)))))),
  );
  return joinBytes(ftyp, moov(ftyp.length + moov(0).length + 8), mdat);
}

export function checkAppleFormat(): void {
  const identifier = "01234567-890a-4bcd-8ef0-123456789abc";
  const timing = { frame: 18, frameCount: 45, fps: 30, width: 16, height: 16 };
  const photo = buildApplePhoto(JPEG, unpairedMovie(), timing, identifier);
  const movie = readAppleMov(photo.mov);
  assert(readAppleJpeg(photo.jpeg) === identifier.toUpperCase(), "JPEG pairing ID");
  assert(movie.assetId === identifier.toUpperCase(), "MOV pairing ID");
  assert(movie.stillTime === 0.6 && movie.sampleValue === 0, "Apple timed metadata");
  assert(new TextDecoder().decode(photo.plist).includes("PFVideoComplementMetadataVersionKey"), "PVT plist");

  const atoms = parseAtoms(photo.mov);
  const mdat = atoms.find((item) => item.type === "mdat")!;
  const moov = atoms.find((item) => item.type === "moov")!;
  const video = requireChild(photo.mov, moov, "trak");
  const mdia = requireChild(photo.mov, video, "mdia");
  const stbl = requireChild(photo.mov, requireChild(photo.mov, mdia, "minf"), "stbl");
  const stco = requireChild(photo.mov, stbl, "stco");
  const offset = dataView(photo.mov).getUint32(stco.payload + 8);
  assert(offset === mdat.payload && matches(photo.mov, offset, SAMPLE), "Video chunk offset was patched");
}

export function checkAndroidFormat(): void {
  const mp4 = atom("ftyp", utf8.encode("mp42"));
  const jpeg = buildAndroidJpeg(JPEG, mp4.length, { frame: 18, fps: 30 });
  const output = joinBytes(jpeg, mp4);
  assert(matches(output, 0, JPEG.subarray(0, 8)), "APP0 stays first");
  const view = dataView(output);
  assert(view.getUint16(8) === 0xffe1, "XMP APP1");
  const xml = new TextDecoder().decode(jpeg.subarray(12, 10 + view.getUint16(10)));
  assert(xml.includes('MotionPhotoPresentationTimestampUs="600000"'), "XMP cover time");
  assert(xml.includes('Item:Semantic="MotionPhoto" Item:Length="' + mp4.length + '"'), "XMP MP4 length");
  assert(view.getUint16(jpeg.length - 2) === 0xffd9 && matches(output, jpeg.length, mp4), "MP4 follows JPEG EOI");
}

export function checkCoverSelection(): void {
  const info = { streams: [{ index: 0, codec_type: "video", nb_frames: "45", width: 16, height: 16 }] };
  assert(selectCover(info).frame === 22, "Default center frame");
  assert(selectCover(info, 0.15).frame === 4, "Nearest-frame ties match Python");
  assert(selectCover(info, 1.499).frame === 44, "Cover stays in stream");
}
