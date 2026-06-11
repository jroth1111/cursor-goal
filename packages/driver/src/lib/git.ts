import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function gitRaw(root: string, cmd: string): string {
  return execSync(cmd, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function gitOutput(root: string, cmd: string): string {
  return gitRaw(root, cmd).trim();
}

function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function hashFile(root: string, rel: string): string {
  try {
    const buf = readFileSync(path.join(root, rel));
    return createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return "missing";
  }
}

/** Driver state lives under .cursor/goal; it must never count as project progress. */
export function isGoalArtifactPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return norm === ".cursor/goal" || norm.startsWith(".cursor/goal/");
}

/**
 * Content-addressed fingerprint of the product working tree, excluding .cursor/goal.
 * Two turns with the same fingerprint produced no observable change — the driver's
 * no-progress and oscillation detectors are built on this.
 */
export function workingTreeFingerprint(root: string): string {
  try {
    const head = gitOutput(root, "git rev-parse HEAD");
    const parts: string[] = [`head:${head}`];

    try {
      const diff = gitRaw(root, 'git diff --binary HEAD -- . ":(exclude).cursor/goal"');
      if (diff) parts.push(`diff:${hashString(diff)}`);
    } catch {
      /* no diff */
    }

    try {
      const staged = gitRaw(root, 'git diff --binary --cached HEAD -- . ":(exclude).cursor/goal"');
      if (staged) parts.push(`staged:${hashString(staged)}`);
    } catch {
      /* no staged diff */
    }

    try {
      const untracked = gitOutput(root, "git ls-files --others --exclude-standard");
      for (const rel of untracked.split("\n").filter(Boolean).sort()) {
        if (isGoalArtifactPath(rel)) continue;
        parts.push(`ut:${rel}:${hashFile(root, rel)}`);
      }
    } catch {
      /* no untracked */
    }

    const dirty = parts.length > 1;
    if (!dirty) return head;
    return `${head}-wt-${hashString(parts.join("\n"))}`;
  } catch {
    try {
      const untracked = gitOutput(root, "git ls-files --others --exclude-standard");
      const productUntracked = untracked
        .split("\n")
        .filter(Boolean)
        .filter((f) => !isGoalArtifactPath(f));
      if (!productUntracked.length) return "no-git";
      const parts = productUntracked.sort().map((rel) => `ut:${rel}:${hashFile(root, rel)}`);
      return `uncommitted-wt-${hashString(parts.join("\n"))}`;
    } catch {
      return "no-git";
    }
  }
}

export function gitTreeId(root: string): string {
  return workingTreeFingerprint(root);
}

/** HEAD commit sha, or null when the repo has no commits / is not a git repo. */
export function headSha(root: string): string | null {
  try {
    return gitOutput(root, "git rev-parse HEAD") || null;
  } catch {
    return null;
  }
}

export type DirtySnapshot = { patch: string; untracked: string[] };

/**
 * Pre-run dirty state vs HEAD: tracked diff (unstaged + staged) plus the untracked
 * file list, excluding driver state. Returns null when the tree is clean. In a repo
 * with no commits the diff is impossible but untracked files still count as dirt.
 */
export function dirtySnapshot(root: string): DirtySnapshot | null {
  let patch = "";
  try {
    // `git diff HEAD` is worktree-vs-HEAD and already CONTAINS staged changes;
    // also concatenating `--cached` would duplicate every staged hunk and make
    // the saved patch fail `git apply`.
    patch += gitRaw(root, 'git diff --binary HEAD -- . ":(exclude).cursor/goal"');
  } catch {
    /* no HEAD or not a repo */
  }
  let untracked: string[] = [];
  try {
    untracked = gitOutput(root, "git ls-files --others --exclude-standard")
      .split("\n")
      .filter(Boolean)
      .filter((f) => !isGoalArtifactPath(f))
      .sort();
  } catch {
    /* not a repo */
  }
  if (!patch && !untracked.length) return null;
  return { patch, untracked };
}

/** `git diff --stat` of the product tree vs a recorded commit (excludes driver state). */
export function diffStatSince(root: string, sha: string): string {
  try {
    return gitRaw(root, `git diff --stat ${sha} -- . ":(exclude).cursor/goal"`);
  } catch {
    return "";
  }
}

/** Full unified diff of the product tree vs a recorded commit (excludes driver state). */
export function diffFullSince(root: string, sha: string): string {
  try {
    return gitRaw(root, `git diff ${sha} -- . ":(exclude).cursor/goal"`);
  } catch {
    return "";
  }
}

/** Untracked product files right now (the agent never commits, so its new files live here). */
export function untrackedProductFiles(root: string): string[] {
  try {
    return gitOutput(root, "git ls-files --others --exclude-standard")
      .split("\n")
      .filter(Boolean)
      .filter((f) => !isGoalArtifactPath(f))
      .sort();
  } catch {
    return [];
  }
}

/** Product files changed vs HEAD (excludes driver state); used to narrate progress. */
export function listDiffFiles(root: string): string[] {
  try {
    const unstaged = gitOutput(root, "git diff --name-only HEAD");
    const staged = gitOutput(root, "git diff --name-only --cached");
    const untracked = gitOutput(root, "git ls-files --others --exclude-standard");
    const all = new Set<string>();
    for (const block of [unstaged, staged, untracked]) {
      for (const f of block.split("\n").filter(Boolean)) {
        if (!isGoalArtifactPath(f)) all.add(f);
      }
    }
    return [...all];
  } catch {
    return [];
  }
}
