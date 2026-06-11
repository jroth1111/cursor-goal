import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { liveLockPid, withDriverLock } from "../lib/lock.js";
import { driverDir, runsDir } from "../lib/paths.js";
import { loadRun } from "../state/store.js";

export type ResetResult = { ok: boolean; message: string; archiveDir?: string };

/** Entries under the driver dir that are never archived. */
const SKIP = new Set([".lock", "runs"]);

function archiveName(startedAt: string, goalId: string): string {
  // filesystem-safe timestamp: 2026-06-10T12:34:56.789Z -> 20260610T123456Z
  const ts = startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${ts}-${goalId}`;
}

async function uniqueDir(base: string): Promise<string> {
  if (!existsSync(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * Archive the current run's state into runs/<started_at>-<goal_id>/ and leave the
 * driver dir ready for a fresh goal. Archiving (not deleting) preserves the audit
 * trail — journals and evidence are the trust story. Refuses while a live driver
 * holds the lock.
 */
export async function resetRun(
  root: string,
  opts: { keepEvidence?: boolean } = {},
): Promise<ResetResult> {
  // friendly fast-path refusal; the real exclusion is the lock below (a bare
  // pid probe alone would be a TOCTOU window against a driver starting now)
  const pid = await liveLockPid(root);
  if (pid != null) {
    return {
      ok: false,
      message: `A driver (pid ${pid}) holds the lock — stop it before resetting.`,
    };
  }

  return withDriverLock(root, async () => {
    const run = await loadRun(root);
    if (!run) {
      return { ok: false, message: "No driver run to reset in this repo." };
    }
    const dir = driverDir(root);
    const archive = await uniqueDir(path.join(runsDir(root), archiveName(run.started_at, run.goal_id)));
    await mkdir(archive, { recursive: true });

    const entries = await readdir(dir, { withFileTypes: true });
    const moved: string[] = [];
    for (const e of entries) {
      if (SKIP.has(e.name)) continue; // .lock is OURS right now; runs/ holds the archives
      if (opts.keepEvidence && e.name === "evidence") continue;
      await rename(path.join(dir, e.name), path.join(archive, e.name));
      moved.push(e.name);
    }

    return {
      ok: true,
      archiveDir: archive,
      message: `Archived ${moved.length} entr${moved.length === 1 ? "y" : "ies"} to ${path.relative(root, archive)} — ready for a new goal.`,
    };
  });
}

/** Number of archived runs (for status). */
export async function archivedRunCount(root: string): Promise<number> {
  try {
    return (await readdir(runsDir(root), { withFileTypes: true })).filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}
