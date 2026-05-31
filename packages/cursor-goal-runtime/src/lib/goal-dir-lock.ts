import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "./paths.js";

const LOCK_DIR = ".lock";
const MAX_ATTEMPTS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockPath(root: string): string {
  return path.join(goalDir(root), LOCK_DIR);
}

/** Exclusive goal-dir lock via atomic mkdir (POSIX). */
export async function withGoalDirLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const dir = lockPath(root);
  await mkdir(path.dirname(dir), { recursive: true });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await mkdir(dir);
      try {
        return await fn();
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      await sleep(20 + Math.floor(Math.random() * 40));
    }
  }

  throw new Error("cursor-goal: goal directory lock timeout");
}
