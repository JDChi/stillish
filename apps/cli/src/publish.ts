import { dlopen, ptr, read } from "bun:ffi";
import { lstat, mkdir, rename, rmdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { getSystemErrorName } from "node:util";

const RENAME_EXCL = 4;

function alreadyExists(destination: string): Error {
  return new Error("成品已存在：" + destination);
}

export async function requireAbsent(destination: string): Promise<void> {
  try {
    await lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw alreadyExists(destination);
}

export async function publish(staged: string, destination: string): Promise<void> {
  if (process.platform === "darwin") {
    const lib = dlopen("/usr/lib/libSystem.B.dylib", {
      renamex_np: { args: ["ptr", "ptr", "u32"], returns: "i32" },
      __error: { args: [], returns: "ptr" },
    });
    try {
      const encoder = new TextEncoder();
      const source = encoder.encode(staged + "\0");
      const target = encoder.encode(destination + "\0");
      if (lib.symbols.renamex_np(ptr(source), ptr(target), RENAME_EXCL) !== 0) {
        const errno = read.i32(lib.symbols.__error()!);
        const code = getSystemErrorName(-errno);
        if (code === "EEXIST") throw alreadyExists(destination);
        throw new Error("无法发布成品：" + destination + " (" + code + ")");
      }
    } finally {
      lib.close();
    }
    return;
  }

  const lock = join(dirname(destination), "." + basename(destination) + ".lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw alreadyExists(destination);
    throw error;
  }
  try {
    await requireAbsent(destination);
    await rename(staged, destination);
  } finally {
    await rmdir(lock);
  }
}
