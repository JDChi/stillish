import { canonicalAssetId, readAppleJpeg, writeAppleJpeg } from "./apple-jpeg";
import { readAppleMov, writeAppleMov } from "./apple-mov";
import { utf8 } from "./bytes";
import { jpegSegment } from "./jpeg";

const metadataPlist = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  "<dict>",
  "  <key>PFVideoComplementMetadataVersionKey</key>",
  "  <string>1</string>",
  "</dict>",
  "</plist>",
  "",
].join("\n");

export interface Cover {
  frame: number;
  fps: number;
}

export interface ApplePhotoTiming extends Cover {
  frameCount: number;
  width: number;
  height: number;
}

export function buildApplePhoto(
  jpeg: Uint8Array, mov: Uint8Array, timing: ApplePhotoTiming, id = crypto.randomUUID(),
): { jpeg: Uint8Array; mov: Uint8Array; plist: Uint8Array } {
  const { frame, fps, frameCount, width, height } = timing;
  const assetId = canonicalAssetId(id);
  const stillTime = frame / fps;
  const pairedJpeg = writeAppleJpeg(jpeg, assetId, width, height);
  const pairedMov = writeAppleMov(mov, assetId, stillTime, frameCount / fps, fps);
  const info = readAppleMov(pairedMov);
  if (readAppleJpeg(pairedJpeg) !== assetId || info.assetId !== assetId || info.sampleValue !== 0
      || Math.abs(info.stillTime - stillTime) > 1 / 60000) {
    throw new Error("Apple 实况照片的配对标识或封面时间校验失败");
  }
  return { jpeg: pairedJpeg, mov: pairedMov, plist: utf8.encode(metadataPlist) };
}

// The caller appends the unchanged MP4. The CLI can stream that part from disk.
export function buildAndroidJpeg(jpeg: Uint8Array, videoLength: number, { frame, fps }: Cover): Uint8Array {
  const timestamp = Math.round(frame * 1_000_000 / fps);
  const xmp = [
    "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">",
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:Camera="http://ns.google.com/photos/1.0/camera/"',
    ' xmlns:Container="http://ns.google.com/photos/1.0/container/"',
    ' xmlns:Item="http://ns.google.com/photos/1.0/container/item/"',
    ' Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1"',
    ' Camera:MotionPhotoPresentationTimestampUs="' + timestamp + '">',
    '<Container:Directory><rdf:Seq>',
    '<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li>',
    '<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="' + videoLength + '"/></rdf:li>',
    '</rdf:Seq></Container:Directory>',
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
  ].join("\n");
  return jpegSegment(jpeg, utf8.encode(xmp));
}
