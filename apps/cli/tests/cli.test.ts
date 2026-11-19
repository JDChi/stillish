import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAppleJpeg } from "../../../packages/core/src/apple-jpeg";
import { readAppleMov } from "../../../packages/core/src/apple-mov";

const ffmpeg = Bun.which("ffmpeg");
const ffprobe = Bun.which("ffprobe");
if (!ffmpeg || !ffprobe) throw new Error("CLI integration tests require ffmpeg and ffprobe on PATH");

const FIXTURE_GIF = "R0lGODlhEAAQAIEAAAAAAP8AAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJKAAAACwAAAAAEAAQAAAILwABCBxIsKDBgwgTKlwoMIDDhw4RQoQocWLEgxYvGswYoKJFjxNBUmRIsqRJkgEBACH5BAlaAAAALAAAAAAQABAAgQAAAAD/AAAAAAAAAAgvAAEIHEiwoMGDCBMqXCgwgMOHDhFChChxYsSDFi8azBigokWPE0FSZEiypEmSAQEAIfkECRQAAAAsAAAAABAAEACBAAAAAAD/AAAAAAAACC8AAQgcSLCgwYMIEypcKDCAw4cOEUKEKHFixIMWLxrMGKCiRY8TQVJkSLKkSZIBAQA7";
const STATIC_GIF = "R0lGODlhEAAQAIEAAAAAAP8AAAAAAAAAACH5BAEoAAAALAAAAAAQABAAQAgwAAEIHEiwYMEACBMiNChQoUKGECNKNOgwIcSKCydq3MjxIMaLHxliDACyYseTBQMCADs=";
const entrypoint = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const binary = process.env.STILLISH_TEST_BINARY;
const command = binary ? [resolve(binary)] : [process.execPath, entrypoint];
let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "stillish-test-"));
  for (const [name, seconds, audio] of [["silent", 3, false], ["voiced", 10, true]] as const) {
    await media(ffmpeg, [
      "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=180x240:r=30",
      ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=650:sample_rate=48000", "-c:a", "aac"] : []),
      "-t", String(seconds), "-c:v", "libx264", join(folder, name + ".mp4"),
    ]);
  }
  // Three transparent, solid-color GIF frames held for 400, 900 and 200 ms.
  await writeFile(join(folder, "variable.GIF"), Buffer.from(FIXTURE_GIF, "base64"));
  await writeFile(join(folder, "static.gif"), Buffer.from(STATIC_GIF, "base64"));
  await writeFile(join(folder, "broken.gif"), "not a GIF");
}, 15_000);

afterAll(async () => {
  if (folder) await rm(folder, { recursive: true, force: true });
});

async function media(tool: string, args: string[]): Promise<Uint8Array> {
  const proc = Bun.spawn([tool, ...args], { stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(15_000) });
  const [out, error, status] = await Promise.all([new Response(proc.stdout).bytes(), new Response(proc.stderr).text(), proc.exited]);
  if (status !== 0) throw new Error(error);
  return out;
}

async function result(proc: Bun.Subprocess<"ignore", "pipe", "pipe">) {
  const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, status };
}

function startCli(args: string[], env = process.env) {
  return Bun.spawn([...command, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
}

function cli(name: string, out: string, args: string[] = []) {
  return result(startCli([join(folder, name), "--out", join(folder, out), ...args]));
}

interface Expected {
  duration: number;
  cover: number;
  audio: boolean;
  width: number;
  height: number;
}

const gif = { duration: 1.5, cover: 22 / 30, audio: false, width: 16, height: 16 };

async function checkVideo(video: string, expected: Expected): Promise<void> {
  const info = JSON.parse(new TextDecoder().decode(
    await media(ffprobe!, ["-v", "error", "-show_streams", "-of", "json", video]),
  ));
  const stream = info.streams.find((track: { codec_type: string }) => track.codec_type === "video");
  expect(stream.codec_name).toBe("h264");
  expect([stream.width, stream.height]).toEqual([expected.width, expected.height]);
  expect(Math.abs(Number(stream.duration) - expected.duration)).toBeLessThanOrEqual(1 / 30);
  expect(info.streams.filter((track: { codec_type: string }) => track.codec_type === "audio")
    .map((track: { codec_name: string }) => track.codec_name)).toEqual(expected.audio ? ["aac"] : []);
  await media(ffmpeg!, ["-v", "error", "-xerror", "-i", video, "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"]);
}

async function checkApple(packageDir: string, stem: string, expected: Expected): Promise<string> {
  const photo = readAppleJpeg(await readFile(join(packageDir, stem + ".jpg")));
  const video = join(packageDir, stem + ".mov");
  const metadata = readAppleMov(await readFile(video));
  expect(metadata.assetId).toBe(photo);
  expect(metadata.sampleValue).toBe(0);
  expect(Math.abs(metadata.stillTime - expected.cover)).toBeLessThan(1 / 60000);
  const packets = JSON.parse(new TextDecoder().decode(await media(
    ffprobe!, ["-v", "error", "-select_streams", "d", "-show_packets", "-of", "json", video],
  ))).packets;
  expect(packets).toHaveLength(1);
  expect(Math.abs(Number(packets[0].pts_time) - expected.cover)).toBeLessThan(1 / 60000);
  expect(await readFile(join(packageDir, "metadata.plist"), "utf8")).toContain("PFVideoComplementMetadataVersionKey");
  await checkVideo(video, expected);
  return video;
}

async function checkAndroid(photo: string, expected: Expected): Promise<string> {
  const data = await readFile(photo);
  const start = data.indexOf("<x:xmpmeta");
  const end = data.indexOf("</x:xmpmeta>", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const xmp = data.subarray(start, end).toString("utf8");
  expect(xmp).toContain('Camera:MotionPhoto="1"');
  const length = Number(xmp.match(/Item:Semantic="MotionPhoto" Item:Length="(\d+)"/)?.[1]);
  expect(length).toBeGreaterThan(0);
  expect(data.subarray(-length - 2, -length).toString("hex")).toBe("ffd9");
  expect(data.subarray(-length + 4, -length + 8).toString()).toBe("ftyp");
  const time = Number(xmp.match(/MotionPhotoPresentationTimestampUs="(\d+)"/)?.[1]) / 1e6;
  expect(Math.abs(time - expected.cover)).toBeLessThan(1e-6);
  const video = photo + ".mp4";
  await writeFile(video, data.subarray(-length));
  await checkVideo(video, expected);
  return video;
}

test("MP4 duration and first audio track in both formats", async () => {
  for (const [name, duration, audio] of [["silent", 3, false], ["voiced", 10, true]] as const) {
    const expected = { duration, cover: duration / 2, audio, width: 180, height: 240 };
    const apple = await cli(name + ".mp4", name);
    expect(apple.status, apple.stderr).toBe(0);
    const android = await cli(name + ".mp4", name, ["--target", "android"]);
    expect(android.status, android.stderr).toBe(0);
    await checkApple(apple.stdout.trim(), name, expected);
    await checkAndroid(android.stdout.trim(), expected);
  }
}, 25_000);

test("GIF keeps one cycle and a white background in both formats", async () => {
  const apple = await cli("variable.GIF", "animated");
  expect(apple.status, apple.stderr).toBe(0);
  const android = await cli("variable.GIF", "animated", ["--target=android"]);
  expect(android.status, android.stderr).toBe(0);
  for (const video of [await checkApple(apple.stdout.trim(), "variable", gif), await checkAndroid(android.stdout.trim(), gif)]) {
    const raw = await media(ffmpeg!, ["-v", "error", "-i", video, "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
    const center = (8 * 16 + 8) * 3;
    const frameSize = 16 * 16 * 3;
    expect(raw.length).toBe(45 * frameSize);
    for (let frame = 0; frame < 45; frame++) {
      const offset = frame * frameSize;
      const pixel = raw.subarray(offset + center, offset + center + 3);
      const channel = frame < 12 ? 0 : frame < 39 ? 1 : 2;
      expect(pixel[channel]).toBeGreaterThan(225);
      expect([...raw.subarray(offset, offset + 3)].every((value) => value >= 240)).toBe(true);
    }
  }
}, 15_000);

test("trim starts during a GIF frame's hold and cover time is relative", async () => {
  const result = await cli("variable.GIF", "trim-gif", ["--start", "0.6", "--duration", "0.3", "--cover", "0.1"]);
  expect(result.status, result.stderr).toBe(0);
  const video = await checkApple(result.stdout.trim(), "variable", { ...gif, duration: 0.3, cover: 0.1 });
  const raw = await media(ffmpeg!, ["-v", "error", "-i", video, "-vf", "crop=2:2:8:8",
    "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]);
  expect(raw.length).toBe(9 * 12);
  for (let offset = 1; offset < raw.length; offset += 3) expect(raw[offset]).toBeGreaterThan(225);
});

test("explicit MP4 trim, cover and option validation", async () => {
  const converted = await cli("voiced.mp4", "trim-mp4", ["--start", "2", "--duration", "3", "--cover", "0.8"]);
  expect(converted.status, converted.stderr).toBe(0);
  await checkApple(converted.stdout.trim(), "voiced", { duration: 3, cover: 0.8, audio: true, width: 180, height: 240 });
  expect((await cli("voiced.mp4", "error", ["--cover", "10"])).status).toBe(1);
  expect((await cli("voiced.mp4", "error", ["--start", "Infinity"])).status).toBe(2);
  expect((await cli("voiced.mp4", "error", ["--target", "bad"])).status).toBe(2);
});

test("static and malformed GIFs leave no partial output", async () => {
  const still = await cli("static.gif", "invalid");
  expect(still.status).toBe(1);
  expect(still.stderr).toContain("包含多帧");
  expect((await cli("broken.gif", "invalid")).status).toBe(1);
  expect(await readdir(join(folder, "invalid"))).toEqual([]);
});

test("concurrent runs publish exactly one result and reject overwrites", async () => {
  await symlink(join(folder, "variable.GIF"), join(folder, "动画 例.GIF"));
  const [first, second] = await Promise.all([cli("动画 例.GIF", "concurrent"), cli("动画 例.GIF", "concurrent")]);
  expect([first.status, second.status].sort()).toEqual([0, 1]);
  expect((first.status ? first : second).stderr).toContain("成品已存在");
  expect(await readdir(join(folder, "concurrent"))).toEqual(["动画 例.pvt"]);
  const movie = join(folder, "concurrent", "动画 例.pvt", "动画 例.mov");
  const before = await readFile(movie);
  expect((await cli("动画 例.GIF", "concurrent")).status).toBe(1);
  expect((await readFile(movie)).equals(before)).toBe(true);
});

test("SIGINT cancels FFmpeg and removes staged files", async () => {
  const tools = join(folder, "cancel-tools");
  const out = join(folder, "cancelled");
  const marker = join(folder, "ffmpeg-running");
  await mkdir(tools);
  await symlink(ffprobe!, join(tools, "ffprobe"));
  const script = join(tools, "ffmpeg");
  await writeFile(script, [
    "#!/bin/sh",
    'if [ "$1" = "-hide_banner" ]; then exec "$REAL_FFMPEG" "$@"; fi',
    ': > "$STILLISH_CANCEL_MARKER"',
    "exec /bin/sleep 15",
  ].join("\n") + "\n");
  await chmod(script, 0o755);
  const child = startCli([join(folder, "silent.mp4"), "--out", out], {
    ...process.env, PATH: tools + ":/usr/bin:/bin", REAL_FFMPEG: ffmpeg!, STILLISH_CANCEL_MARKER: marker,
  });
  const reading = result(child);
  try {
    for (let i = 0; i < 200 && !(await Bun.file(marker).exists()); i++) await Bun.sleep(20);
    expect(await Bun.file(marker).exists()).toBe(true);
    child.kill("SIGINT");
    const stopped = await reading;
    expect(stopped.status, stopped.stderr).toBe(130);
    expect(stopped.stderr).toContain("已取消");
    expect(await readdir(out)).toEqual([]);
  } finally {
    if (child.exitCode === null) child.kill();
    await reading;
  }
}, 10_000);
