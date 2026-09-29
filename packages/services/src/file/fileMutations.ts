import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { parse, resolve } from "node:path";

const MAX_TEXT_WRITE_BYTES = 1024 * 1024;

/** 变更只能落在 Host 磁盘上，并拒绝把根目录本身当成目标。 */
export function assertMutableHostPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Path is empty");
  }
  const resolved = resolve(trimmed);
  if (resolved === parse(resolved).root) {
    throw new Error("Refusing to mutate the filesystem root");
  }
  return resolved;
}

export async function createHostDirectory(path: string): Promise<{ path: string }> {
  const directoryPath = assertMutableHostPath(path);
  await mkdir(directoryPath);
  return { path: directoryPath };
}

export async function writeHostTextFile(
  path: string,
  content: string,
): Promise<{ path: string; bytesWritten: number }> {
  const filePath = assertMutableHostPath(path);
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength > MAX_TEXT_WRITE_BYTES) {
    throw new Error(`Text file exceeds ${MAX_TEXT_WRITE_BYTES} bytes`);
  }
  const existing = await lstat(filePath).catch(() => null);
  if (existing?.isDirectory()) {
    throw new Error(`Path is a directory: ${filePath}`);
  }
  await writeFile(filePath, bytes, { flag: "wx" });
  return { path: filePath, bytesWritten: bytes.byteLength };
}

export async function renameHostPath(from: string, to: string): Promise<{ path: string }> {
  const source = assertMutableHostPath(from);
  const target = assertMutableHostPath(to);
  if (source === target) {
    return { path: target };
  }
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    throw new Error(`Target already exists: ${target}`);
  }
  await rename(source, target);
  return { path: target };
}

export async function removeHostPath(path: string): Promise<void> {
  const target = assertMutableHostPath(path);
  const info = await lstat(target);
  if (info.isSymbolicLink()) {
    await rm(target);
    return;
  }
  await rm(target, { recursive: true });
}
