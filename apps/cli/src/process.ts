import { basename } from "node:path";
import { homedir } from "node:os";

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? homedir() + path.slice(1) : path;
}

export async function runTool(program: string, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const proc = Bun.spawn([program, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", signal });
  const [out, error, status] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  signal.throwIfAborted();
  if (status !== 0) {
    throw new Error(basename(program) + " 处理失败：" + (error.trim() || "退出码 " + status));
  }
  return out;
}
