import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { diffStatSince, headSha, untrackedProductFiles } from "../lib/git.js";

/**
 * Run isolation via a git worktree: the agent gets a disposable copy of the repo
 * (branched from HEAD) and the user's checkout is never mutated. Adoption is the
 * human's act — the driver never merges. Worktrees and their state are fully
 * disjoint: the driver lock and `.cursor/goal/driver` live INSIDE the worktree,
 * so a run there and a run in the main checkout cannot race each other.
 *
 * Sharp edge (documented in the RUNBOOK): node_modules and build caches do not
 * follow the worktree — checks that need installed deps must install there.
 */

export type WorktreeOutcome =
  | { ok: true; root: string; branch: string }
  | { ok: false; message: string };

function git(root: string, cmd: string): string {
  return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function worktreesDir(mainRoot: string): string {
  return path.join(mainRoot, ".cursor", "goal", "worktrees");
}

export function createRunWorktree(mainRoot: string, goalText: string): WorktreeOutcome {
  if (!headSha(mainRoot)) {
    return { ok: false, message: "Cannot isolate in a worktree: the repo has no commits yet." };
  }
  const id = createHash("sha256").update(goalText).digest("hex").slice(0, 12);
  mkdirSync(worktreesDir(mainRoot), { recursive: true });

  const branchExists = (b: string): boolean => {
    try {
      git(mainRoot, `git rev-parse --verify --quiet "refs/heads/${b}"`);
      return true;
    } catch {
      return false;
    }
  };
  // a removed worktree leaves its branch behind — both must be free
  let dir = path.join(worktreesDir(mainRoot), id);
  let branch = `agent-driver/${id}`;
  for (let n = 2; existsSync(dir) || branchExists(branch); n++) {
    dir = path.join(worktreesDir(mainRoot), `${id}-${n}`);
    branch = `agent-driver/${id}-${n}`;
  }

  try {
    git(mainRoot, `git worktree add "${dir}" -b "${branch}" HEAD`);
  } catch (e) {
    return {
      ok: false,
      message: `git worktree add failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // The goal contract the operator JUST wrote wins: the worktree materializes
  // HEAD, which silently loses GOAL.md when it is untracked AND when it is
  // tracked-but-edited-uncommitted — so always overwrite with the live copy.
  const mainGoal = path.join(mainRoot, "GOAL.md");
  if (existsSync(mainGoal)) {
    copyFileSync(mainGoal, path.join(dir, "GOAL.md"));
  }

  return { ok: true, root: dir, branch };
}

/** Post-run summary: where the work lives and how to adopt or discard it. */
export function worktreeSummary(mainRoot: string, wtRoot: string, branch: string): string {
  // lib/git.ts owns the driver-state exclusion rule — one encoding, not two
  const stat = diffStatSince(wtRoot, "HEAD");
  const untracked = untrackedProductFiles(wtRoot);
  return [
    "── worktree run ────────────────────────────────────────────",
    `worktree: ${wtRoot}`,
    `branch:   ${branch}`,
    stat.trim() ? stat.trimEnd() : "(no tracked changes)",
    untracked.length ? `untracked: ${untracked.join(", ")}` : "",
    "",
    "adopt:    cd into the worktree, review, commit, then merge/cherry-pick the branch",
    `discard:  git -C "${mainRoot}" worktree remove --force "${wtRoot}"`,
    "────────────────────────────────────────────────────────────",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
