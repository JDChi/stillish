// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 杨振
import { dataView, joinBytes, utf8, words } from "./bytes";

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "dinf", "stbl", "edts", "tref", "gmhd", "udta", "ilst"]);
const MAX_U32 = 0xffffffff;

export interface Atom {
  start: number;
  end: number;
  payload: number;
  type: string;
}

export function atomHeader(type: string, payloadSize: number): Uint8Array {
  const kind = utf8.encode(type);
  if (kind.length !== 4) throw new Error("ISO-BMFF atom 类型必须是 4 字节");
  if (payloadSize + 8 <= MAX_U32) return joinBytes(words(payloadSize + 8), kind);
  const extended = new Uint8Array(8);
  dataView(extended).setBigUint64(0, BigInt(payloadSize + 16));
  return joinBytes(words(1), kind, extended);
}

export function atom(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  return joinBytes(atomHeader(type, size), ...parts);
}

export function parseAtoms(data: Uint8Array, start = 0, end = data.length): Atom[] {
  if (start < 0 || end > data.length || start > end) throw new Error("ISO-BMFF 解析范围无效");
  const view = dataView(data);
  const atoms: Atom[] = [];
  for (let position = start; position < end;) {
    if (position + 8 > end) throw new Error("ISO-BMFF atom 头部不完整");
    const type = String.fromCharCode(...data.subarray(position + 4, position + 8));
    let size = view.getUint32(position);
    let header = 8;
    if (size === 1) {
      header = 16;
      if (position + header > end) throw new Error("ISO-BMFF 64 位 atom 头部不完整");
      size = Number(view.getBigUint64(position + 8));
    } else if (size === 0) {
      size = end - position;
    }
    if (size < header || size > end - position) throw new Error("ISO-BMFF atom " + type + " 超出文件边界");
    atoms.push({ start: position, end: position + size, payload: position + header, type });
    position += size;
  }
  return atoms;
}

export function children(data: Uint8Array, parent: Atom): Atom[] {
  return parseAtoms(data, parent.payload, parent.end);
}

export function firstChild(data: Uint8Array, parent: Atom, type: string): Atom | undefined {
  return children(data, parent).find((item) => item.type === type);
}

export function requireChild(data: Uint8Array, parent: Atom, type: string): Atom {
  const child = firstChild(data, parent, type);
  if (!child) throw new Error("MOV 缺少 " + type);
  return child;
}

export function patchChunkOffsets(moov: Uint8Array, delta: number): Uint8Array {
  const result = moov.slice();
  const view = dataView(result);
  const top = parseAtoms(result);
  if (top.length !== 1 || top[0].type !== "moov") throw new Error("需要一个完整的 moov atom");

  function visit(parent: Atom): void {
    for (const item of children(result, parent)) {
      if (CONTAINERS.has(item.type)) {
        visit(item);
      } else if (item.type === "stco" || item.type === "co64") {
        const entries = item.payload + 8;
        if (entries > item.end) throw new Error("MOV chunk offset 表不完整");
        const count = view.getUint32(item.payload + 4);
        const width = item.type === "stco" ? 4 : 8;
        if (entries + count * width > item.end) throw new Error("MOV chunk offset 条目超出 atom");
        for (let index = 0; index < count; index++) {
          const position = entries + index * width;
          const old = width === 4 ? BigInt(view.getUint32(position)) : view.getBigUint64(position);
          const next = old + BigInt(delta);
          if (next < 0n || next >= 1n << BigInt(width * 8)) throw new Error("MOV chunk offset 调整后越界");
          if (width === 4) {
            view.setUint32(position, Number(next));
          } else {
            view.setBigUint64(position, next);
          }
        }
      }
    }
  }

  visit(top[0]);
  return result;
}
