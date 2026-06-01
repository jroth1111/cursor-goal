import { existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function existingRealPath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function gitRootFromCwd(): string | null {
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function cursorHooksRoot(): string {
  return existingRealPath(path.join(process.env.CURSOR_HOME ?? path.join(os.homedir(), ".cursor"), "hooks"));
}

export function isHookInstallRoot(root: string): boolean {
  const normalizedRoot = existingRealPath(root);
  const hooks = cursorHooksRoot();
  return normalizedRoot === hooks || normalizedRoot.startsWith(`${hooks}${path.sep}`);
}

export function projectRoot(): string {
  const envRoot = process.env.CURSOR_PROJECT_DIR;
  const root = existingRealPath(envRoot?.trim() ? envRoot : gitRootFromCwd() ?? process.cwd());
  if (!envRoot?.trim() && isHookInstallRoot(root)) {
    throw new Error(
      `CURSOR_PROJECT_DIR missing; refusing to use global hooks directory as project root: ${root}`,
    );
  }
  return root;
}

export function goalDir(root = projectRoot()): string {
  return path.join(root, ".cursor", "goal");
}

export function passportsDir(root = projectRoot()): string {
  return path.join(goalDir(root), "passports");
}

export function goalMd(root = projectRoot()): string {
  return path.join(root, "GOAL.md");
}

export async function ensureGoalDirs(root = projectRoot()): Promise<void> {
  await mkdir(path.join(goalDir(root), "evidence"), { recursive: true });
  await mkdir(passportsDir(root), { recursive: true });
}

export async function readJson<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** Atomic write (tmp + rename) for hot goal artifacts. */
export async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export async function fileMtimeMs(file: string): Promise<number | null> {
  if (!existsSync(file)) return null;
  try {
    const s = await stat(file);
    return s.mtimeMs;
  } catch {
    return null;
  }
}
