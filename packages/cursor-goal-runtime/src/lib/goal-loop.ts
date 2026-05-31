import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { withGoalDirLock } from "./goal-dir-lock.js";
import { goalDir, projectRoot, readJson } from "./paths.js";
import { readLoopLimit } from "./loop-limit.js";

export type GoalLoopFile = {
  total_blocked_stops: number;
  loop_limit: number;
  updated_at: string;
};

export function goalLoopPath(root?: string): string {
  return path.join(goalDir(root), "goal-loop.json");
}

async function readGoalLoopFile(root: string): Promise<GoalLoopFile | null> {
  const p = goalLoopPath(root);
  if (!existsSync(p)) return null;
  try {
    return await readJson<GoalLoopFile>(p);
  } catch {
    return null;
  }
}

async function writeGoalLoopFile(root: string, data: GoalLoopFile): Promise<void> {
  const file = goalLoopPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

/** Seed from runtime-state.json when goal-loop.json is missing (legacy or repo summary). */
async function seedFromLegacyRuntimeState(root: string): Promise<number> {
  const legacyPath = path.join(goalDir(root), "runtime-state.json");
  if (!existsSync(legacyPath)) return 0;
  try {
    const legacy = await readJson<{ loop_count?: number; total_blocked_stops?: number }>(
      legacyPath,
    );
    if (typeof legacy?.total_blocked_stops === "number" && legacy.total_blocked_stops >= 0) {
      return legacy.total_blocked_stops;
    }
    if (typeof legacy?.loop_count === "number" && legacy.loop_count >= 0) {
      return legacy.loop_count;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

export async function readRepoBlockedStopTotal(root?: string): Promise<number> {
  const r = root ?? projectRoot();
  const file = await readGoalLoopFile(r);
  if (
    typeof file?.total_blocked_stops === "number" &&
    file.total_blocked_stops >= 0
  ) {
    return file.total_blocked_stops;
  }
  return seedFromLegacyRuntimeState(r);
}

/** Caller must hold goal-dir lock. */
export async function incrementRepoBlockedStopTotalUnlocked(root: string): Promise<number> {
  const limit = await readLoopLimit(root);
  const existing = await readGoalLoopFile(root);
  const base =
    typeof existing?.total_blocked_stops === "number" &&
    existing.total_blocked_stops >= 0
      ? existing.total_blocked_stops
      : await seedFromLegacyRuntimeState(root);
  const next = base + 1;
  await writeGoalLoopFile(root, {
    total_blocked_stops: next,
    loop_limit: limit,
    updated_at: new Date().toISOString(),
  });
  return next;
}

export async function incrementRepoBlockedStopTotal(root?: string): Promise<number> {
  const r = root ?? projectRoot();
  return withGoalDirLock(r, async () => incrementRepoBlockedStopTotalUnlocked(r));
}

/** Caller must hold goal-dir lock. */
export async function resetRepoBlockedStopTotalUnlocked(root: string): Promise<void> {
  const limit = await readLoopLimit(root);
  await writeGoalLoopFile(root, {
    total_blocked_stops: 0,
    loop_limit: limit,
    updated_at: new Date().toISOString(),
  });
}

export async function resetRepoBlockedStopTotal(root?: string): Promise<void> {
  const r = root ?? projectRoot();
  await withGoalDirLock(r, async () => resetRepoBlockedStopTotalUnlocked(r));
}
