import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { driverDir } from "./paths.js";

const LOCK_DIR = ".lock";
const MAX_ATTEMPTS = 50;
const STALE_LOCK_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockPath(root: string): string {
  return path.join(driverDir(root), LOCK_DIR);
}

function ownerPath(dir: string): string {
  return path.join(dir, "owner.json");
}

function pidIsAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readOwner(dir: string): Promise<{ pid?: unknown; started_at?: unknown } | null> {
  try {
    return JSON.parse(await readFile(ownerPath(dir), "utf8")) as {
      pid?: unknown;
      started_at?: unknown;
    };
  } catch {
    return null;
  }
}

async function writeOwner(dir: string): Promise<void> {
  await writeFile(
    ownerPath(dir),
    `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

function ownerAgeMs(owner: { started_at?: unknown } | null): number | null {
  const started = Date.parse(typeof owner?.started_at === "string" ? owner.started_at : "");
  return Number.isNaN(started) ? null : Date.now() - started;
}

async function removeStaleLockIfNeeded(dir: string): Promise<void> {
  let s;
  try {
    s = await stat(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  const owner = await readOwner(dir);
  if (pidIsAlive(owner?.pid)) return;
  const dirAgeMs = Date.now() - s.mtimeMs;
  const ageMs = Math.max(dirAgeMs, ownerAgeMs(owner) ?? dirAgeMs);
  if (ageMs > STALE_LOCK_MS) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Pid of a LIVE process currently holding the driver lock, or null (no lock,
 * stale lock, dead holder). Read-only — used by verbs like `reset` that must
 * refuse to touch state while a driver is running.
 */
export async function liveLockPid(root: string): Promise<number | null> {
  const owner = await readOwner(lockPath(root));
  return pidIsAlive(owner?.pid) ? Number(owner?.pid) : null;
}

/**
 * Exclusive driver-dir lock via atomic mkdir (POSIX). Guarantees a background
 * `agent-driver run` and an interactive `driver next` hook never race the same state.
 */
export async function withDriverLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const dir = lockPath(root);
  await mkdir(path.dirname(dir), { recursive: true });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await mkdir(dir);
      try {
        await writeOwner(dir);
        return await fn();
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      await removeStaleLockIfNeeded(dir);
      await sleep(20 + Math.floor(Math.random() * 40));
    }
  }

  throw new Error("agent-driver: driver directory lock timeout");
}
