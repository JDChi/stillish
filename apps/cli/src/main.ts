import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { help, parseOptions, usage, type ConvertOptions } from "./arguments";
import {
  appleMovieArgs, buildAndroidJpeg, buildApplePhoto, coverArgs, probeArgs,
  selectCover, transcodeArgs, type ProbeResult,
} from "@stillish/core";
import apacheLicense from "@stillish/core/licenses/Apache-2.0.txt" with { type: "text" };
import notice from "@stillish/core/licenses/NOTICE.txt" with { type: "text" };
import { resolveTools } from "./dependencies";
import { expandHome, runTool } from "./process";
import { publish, requireAbsent } from "./publish";

async function convert(options: ConvertOptions, signal: AbortSignal): Promise<string> {
  const source = resolve(expandHome(options.input));
  const extension = extname(source).toLowerCase();
  if (![".mp4", ".gif"].includes(extension) || !(await stat(source).catch(() => null))?.isFile()) {
    throw new Error("请输入一个存在的 .mp4 或 .gif 文件。");
  }

  const requestedDir = resolve(expandHome(options.out));
  await mkdir(requestedDir, { recursive: true });
  const directory = await realpath(requestedDir);
  const stem = basename(source, extname(source));
  const name = stem + (options.target === "android" ? "MP.jpg" : ".pvt");
  const destination = join(directory, name);
  await requireAbsent(destination);
  const temp = await mkdtemp(join(directory, ".stillish-"));

  try {
    const tools = await resolveTools(signal);
    const ffmpeg = (args: string[]) => runTool(tools.ffmpeg, args, signal);
    const probe = async (file: string, gif = false) =>
      JSON.parse(await runTool(tools.ffprobe, probeArgs(file, gif), signal)) as ProbeResult;
    const gif = extension === ".gif";
    const movie = join(temp, "video.mp4");
    const cover = join(temp, "cover.jpg");
    await ffmpeg(transcodeArgs(await probe(source, gif), gif, source, movie, options));
    const timing = selectCover(await probe(movie), options.cover);
    await ffmpeg(coverArgs(movie, timing.frame, cover));

    const staged = join(temp, name);
    const jpeg = await readFile(cover);
    if (options.target === "android") {
      const prefix = buildAndroidJpeg(jpeg, (await stat(movie)).size, timing);
      async function* motionPhoto() {
        yield prefix;
        yield* createReadStream(movie);
      }
      await pipeline(Readable.from(motionPhoto()), createWriteStream(staged, { flags: "wx" }), { signal });
    } else {
      const mov = join(temp, "unpaired.mov");
      await ffmpeg(appleMovieArgs(movie, mov));
      const output = buildApplePhoto(jpeg, await readFile(mov), timing);
      await mkdir(staged);
      await writeFile(join(staged, stem + ".jpg"), output.jpeg);
      await writeFile(join(staged, stem + ".mov"), output.mov);
      await writeFile(join(staged, "metadata.plist"), output.plist);
    }

    signal.throwIfAborted();
    await publish(staged, destination);
    return destination;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main(args: string[]): Promise<number> {
  let options: ConvertOptions | "help" | "license";
  try {
    options = parseOptions(args);
  } catch (error) {
    process.stderr.write(usage + "\nstillish: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 2;
  }
  if (options === "help") {
    process.stdout.write(help);
    return 0;
  }
  if (options === "license") {
    process.stdout.write(notice + "\n" + apacheLicense);
    return 0;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    process.stdout.write(await convert(options, controller.signal) + "\n");
    return 0;
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write("stillish: 已取消。\n");
      return 130;
    }
    process.stderr.write("stillish: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 1;
  } finally {
    process.off("SIGINT", interrupt);
  }
}

process.exitCode = await main(process.argv.slice(2));
