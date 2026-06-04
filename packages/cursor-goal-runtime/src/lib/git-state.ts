import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { cursorHome } from "./template.js";
import { goalDir, projectRoot, readJson, writeJson } from "./paths.js";

export type GoalState = {
  last_edit_tree?: string;
  last_proof_tree?: string;
  last_edit_at?: string;
  loop_count?: number;
};

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

export function isGoalArtifactPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return norm === ".cursor/goal" || norm.startsWith(".cursor/goal/");
}

/** Content-addressed working tree fingerprint excluding .cursor/goal artifacts. */
export function workingTreeFingerprint(root: string): string {
  try {
    const head = gitOutput(root, "git rev-parse HEAD");
    const parts: string[] = [`head:${head}`];

    try {
      const diff = gitRaw(
        root,
        'git diff --binary HEAD -- . ":(exclude).cursor/goal"',
      );
      if (diff) parts.push(`diff:${hashString(diff)}`);
    } catch {
      /* no diff */
    }

    try {
      const staged = gitRaw(
        root,
        'git diff --binary --cached HEAD -- . ":(exclude).cursor/goal"',
      );
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
      const parts = productUntracked
        .sort()
        .map((rel) => `ut:${rel}:${hashFile(root, rel)}`);
      return `uncommitted-wt-${hashString(parts.join("\n"))}`;
    } catch {
      return "no-git";
    }
  }
}

/** Uses content-addressed fingerprint (name kept for callers). */
export function gitTreeId(root: string): string {
  return workingTreeFingerprint(root);
}

export function statePath(root = projectRoot()): string {
  return path.join(goalDir(root), "state.json");
}

export async function readState(root = projectRoot()): Promise<GoalState> {
  return (await readJson<GoalState>(statePath(root))) ?? {};
}

export async function writeState(root: string, patch: Partial<GoalState>): Promise<void> {
  const cur = await readState(root);
  await writeJson(statePath(root), { ...cur, ...patch });
}

export async function markEdit(root = projectRoot()): Promise<void> {
  await writeState(root, {
    last_edit_tree: gitTreeId(root),
    last_edit_at: new Date().toISOString(),
  });
}

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

function readLoopLimitFromHooksFile(filePath: string): number | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf8");
    type HooksMap = { hooks?: HooksMap; stop?: Array<{ loop_limit?: number }> };
    const cfg = JSON.parse(raw) as { hooks?: HooksMap };
    let hooks = cfg.hooks;
    for (let i = 0; i < 8 && hooks?.hooks; i += 1) {
      hooks = hooks.hooks;
    }
    const stop = hooks?.stop;
    if (!stop?.length) return null;
    for (const h of stop) {
      if (typeof h.loop_limit === "number" && h.loop_limit >= 1) return h.loop_limit;
    }
    return null;
  } catch {
    return null;
  }
}

/** Project `.cursor/hooks.json` only (global fallback is applied in loop-limit.ts). */
export function readLoopLimitFromHooksJson(root: string): number | null {
  return readLoopLimitFromHooksFile(path.join(root, ".cursor", "hooks.json"));
}

export function readLoopLimitFromGlobalHooksJson(): number | null {
  return readLoopLimitFromHooksFile(path.join(cursorHome(), "hooks.json"));
}
