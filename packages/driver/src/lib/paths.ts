import { existsSync, realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/**
 * Project root for a driver run. Honors CURSOR_PROJECT_DIR (set by hooks),
 * else the git toplevel, else cwd.
 */
export function projectRoot(): string {
  const envRoot = process.env.CURSOR_PROJECT_DIR;
  return existingRealPath(envRoot?.trim() ? envRoot : gitRootFromCwd() ?? process.cwd());
}

/** Root of all driver state. Excluded from the working-tree fingerprint (under .cursor/goal). */
export function driverDir(root = projectRoot()): string {
  return path.join(root, ".cursor", "goal", "driver");
}

export function runJsonPath(root = projectRoot()): string {
  return path.join(driverDir(root), "run.json");
}

export function taskGraphPath(root = projectRoot()): string {
  return path.join(driverDir(root), "task-graph.json");
}

export function journalPath(root = projectRoot()): string {
  return path.join(driverDir(root), "journal.jsonl");
}

export function escalationPath(root = projectRoot()): string {
  return path.join(driverDir(root), "ESCALATION.json");
}

export function contextPath(root: string, taskId: string): string {
  return path.join(driverDir(root), "context", `${taskId}.json`);
}

export function evidenceDir(root = projectRoot()): string {
  return path.join(driverDir(root), "evidence");
}

/** Archived prior runs (written by `agent-driver reset`). */
export function runsDir(root = projectRoot()): string {
  return path.join(driverDir(root), "runs");
}

/** Per-call NDJSON transcripts (turn/decompose/verdict/review/replan streams). */
export function transcriptsDir(root = projectRoot()): string {
  return path.join(evidenceDir(root), "turns");
}

/** The pre-run untracked-file list saved beside baseline/dirty.patch at intake —
 *  written by state/store.ts (captureBaseline), read by driver/diff.ts. */
export function baselineUntrackedPath(root = projectRoot()): string {
  return path.join(evidenceDir(root), "baseline", "untracked.txt");
}

export function goalMdPath(root = projectRoot()): string {
  return path.join(root, "GOAL.md");
}

export async function ensureDriverDirs(root = projectRoot()): Promise<void> {
  await mkdir(path.join(driverDir(root), "context"), { recursive: true });
  await mkdir(path.join(evidenceDir(root), "turns"), { recursive: true });
}

export async function readJson<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** Atomic write (tmp + rename) so a crash never leaves a half-written state file. */
export async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}
