import { parseArgs } from "node:util";
import type { ClipOptions } from "@stillish/core";

const definitions = {
  help: { type: "boolean", short: "h" },
  license: { type: "boolean" },
  target: { type: "string" },
  out: { type: "string" },
  start: { type: "string" },
  duration: { type: "string" },
  cover: { type: "string" },
} as const;

export const usage = "usage: stillish [-h] [--target {apple,android}] [--out 目录] [--start 秒] "
  + "[--duration 秒] [--cover 秒] input";

export const help = [
  usage,
  "",
  "照样动 · 将 MP4 或 GIF 转成实况照片",
  "",
  "  input                     输入 MP4 或 GIF 动图文件",
  "  -h, --help                显示帮助信息",
  "  --license                 显示第三方许可和署名",
  "  --target {apple,android}  输出格式，默认 apple",
  "  --out 目录                输出目录，默认当前目录",
  "  --start 秒                截取起点，默认 0",
  "  --duration 秒             需要保留的时长，默认到片段末尾",
  "  --cover 秒                片段内封面时间，默认中间帧",
  "",
].join("\n");

export interface ConvertOptions extends ClipOptions {
  input: string;
  out: string;
  target: "apple" | "android";
}

function seconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const decimal = /^[+-]?(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:e[+-]?[0-9](?:_?[0-9])*)?$/i;
  const time = Number(value.trim().replaceAll("_", ""));
  if (!decimal.test(value.trim()) || !Number.isFinite(time) || time < 0) {
    throw new Error("秒数须为非负有限值。");
  }
  return time;
}

function expandOptions(args: string[]): string[] {
  let positional = false;
  return args.map((arg) => {
    if (arg === "--") positional = true;
    if (positional || !arg.startsWith("--")) return arg;
    const equal = arg.indexOf("=");
    const name = arg.slice(2, equal === -1 ? undefined : equal);
    const matches = Object.keys(definitions).filter((option) => option.startsWith(name));
    return matches.length === 1 ? "--" + matches[0] + (equal === -1 ? "" : arg.slice(equal)) : arg;
  });
}

export function parseOptions(args: string[]): ConvertOptions | "help" | "license" {
  const { values, positionals } = parseArgs({
    args: expandOptions(args), options: definitions, allowPositionals: true, strict: true,
  });
  if (values.help) return "help";
  if (values.license) return "license";
  if (positionals.length !== 1) throw new Error("请输入一个 MP4 或 GIF 文件。");
  const target = values.target ?? "apple";
  if (target !== "apple" && target !== "android") throw new Error("--target 须为 apple 或 android。");
  return {
    input: positionals[0],
    target,
    out: values.out ?? process.cwd(),
    start: seconds(values.start) ?? 0,
    duration: seconds(values.duration),
    cover: seconds(values.cover),
  };
}
