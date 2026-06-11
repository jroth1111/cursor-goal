import { existsSync, readFileSync } from "node:fs";
import { diffFullSince, diffStatSince, untrackedProductFiles } from "../lib/git.js";
import { baselineUntrackedPath } from "../lib/paths.js";
import { loadRun } from "../state/store.js";

export type DiffOutcome =
  | { ok: false; message: string }
  | {
      ok: true;
      /** tracked changes vs the baseline commit (stat or full per request). */
      diff: string;
      /** files that did not exist at baseline (the agent never commits — its new files are untracked). */
      newFiles: string[];
      /** present when the tree was dirty at intake: those changes are mixed in below. */
      dirtyNote: string | null;
    };

/**
 * The run's cumulative footprint vs the baseline recorded at intake. This is the
 * "review the agent like a PR" view: tracked edits as a git diff against the
 * baseline commit, plus files created since baseline. When the user started
 * dirty we do not attempt patch subtraction (fragile) — we say so and point at
 * the recorded pre-run snapshot.
 */
export async function runDiff(root: string, opts: { full?: boolean } = {}): Promise<DiffOutcome> {
  const run = await loadRun(root);
  if (!run) return { ok: false, message: "No driver run in this repo; nothing to diff." };
  if (!run.baseline) {
    return {
      ok: false,
      message:
        "This run predates baseline capture (no baseline in run.json) — diff against the starting point is not reconstructible.",
    };
  }
  const { head_sha, dirty_patch_artifact } = run.baseline;
  if (!head_sha) {
    return {
      ok: false,
      message: "Baseline has no commit (repo had no commits at intake) — use git status; everything is new.",
    };
  }

  const diff = opts.full ? diffFullSince(root, head_sha) : diffStatSince(root, head_sha);

  // untracked now minus untracked at baseline = files the run (or the operator) added
  const baselineUntrackedFile = dirty_patch_artifact ? baselineUntrackedPath(root) : null;
  const baselineUntracked = new Set(
    baselineUntrackedFile && existsSync(baselineUntrackedFile)
      ? readFileSync(baselineUntrackedFile, "utf8").split("\n").filter(Boolean)
      : [],
  );
  const newFiles = untrackedProductFiles(root).filter((f) => !baselineUntracked.has(f));

  const dirtyNote = dirty_patch_artifact
    ? `note: the tree was dirty at intake — pre-run changes are included above; pre-run snapshot: ${dirty_patch_artifact}`
    : null;

  return { ok: true, diff, newFiles, dirtyNote };
}

export function formatDiff(outcome: DiffOutcome): string {
  if (!outcome.ok) return `${outcome.message}\n`;
  const parts: string[] = [];
  if (outcome.diff.trim()) parts.push(outcome.diff.trimEnd());
  if (outcome.newFiles.length) {
    parts.push(`new files since baseline (untracked):\n${outcome.newFiles.map((f) => `  + ${f}`).join("\n")}`);
  }
  if (!parts.length) parts.push("no changes vs baseline");
  if (outcome.dirtyNote) parts.push(outcome.dirtyNote);
  return `${parts.join("\n\n")}\n`;
}
