import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveTools } from "../src/dependencies";

const originalPath = process.env.PATH!;
const originalCache = process.env.STILLISH_CACHE_DIR;
const signal = new AbortController().signal;
const officialArchive = process.env.STILLISH_TEST_FFMPEG_ARCHIVE;
const pinnedDirectory = "ffmpeg-2026.06.11-macos-arm64";
const packagedPlatform = process.platform === "darwin" && process.arch === "arm64";
let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "stillish-cache-test-"));
  process.env.STILLISH_CACHE_DIR = folder;
});

afterEach(async () => {
  process.env.PATH = originalPath;
  if (originalCache === undefined) delete process.env.STILLISH_CACHE_DIR;
  else process.env.STILLISH_CACHE_DIR = originalCache;
  await rm(folder, { recursive: true, force: true });
});

function offline(): never {
  throw new Error("The network must not be used");
}

test("system pair is checked first", async () => {
  const ffmpeg = await realpath(Bun.which("ffmpeg")!);
  const ffprobe = await realpath(Bun.which("ffprobe")!);
  expect(await resolveTools(signal, offline)).toEqual({ ffmpeg, ffprobe });
  expect(await readdir(folder)).toEqual([]);
});

test.skipIf(!packagedPlatform)("existing macOS cache works without FFmpeg on PATH", async () => {
  const cached = join(folder, pinnedDirectory);
  await mkdir(cached);
  for (const name of ["ffmpeg", "ffprobe"]) await symlink(Bun.which(name)!, join(cached, name));
  process.env.PATH = "/usr/bin:/bin";
  expect(await resolveTools(signal, offline)).toEqual({
    ffmpeg: join(cached, "ffmpeg"), ffprobe: join(cached, "ffprobe"),
  });
});

test.skipIf(!packagedPlatform)("wrong digest is rejected and download staging is removed", async () => {
  process.env.PATH = "/usr/bin:/bin";
  await expect(resolveTools(signal, async () => new Response("wrong archive"))).rejects.toThrow("SHA-256");
  expect(await readdir(folder)).toEqual([]);
});

test.skipIf(!packagedPlatform || !officialArchive)("verified release populates an empty cache and works offline", async () => {
  process.env.PATH = "/usr/bin:/bin";
  let requests = 0;
  const tools = await resolveTools(signal, async (url) => {
    expect(url).toContain("ffmpeg-2026.06.11/ffmpeg-macos-arm64.tar.gz");
    requests++;
    return new Response(Bun.file(officialArchive!));
  });
  expect(requests).toBe(1);
  expect(await readdir(folder)).toEqual([pinnedDirectory]);
  expect(await resolveTools(signal, offline)).toEqual(tools);
}, 30_000);
