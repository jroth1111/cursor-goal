import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { goalDir, projectRoot, readJson, writeJson } from "./paths.js";

export type GoalState = {
  last_edit_tree?: string;
  last_proof_tree?: string;
  last_edit_at?: string;
  loop_count?: number;
};

function gitOutput(root: string, cmd: string): string {
  return execSync(cmd, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function gitTreeId(root: string): string {
  try {
    const head = gitOutput(root, "git rev-parse HEAD");
    const dirty = gitOutput(root, "git status --porcelain");
    if (!dirty) return head;
    return `${head}-dirty-${hashString(dirty)}`;
  } catch {
    try {
      const dirty = gitOutput(root, "git status --porcelain");
      return dirty ? `uncommitted-${hashString(dirty)}` : "no-git";
    } catch {
      return "no-git";
    }
  }
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
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
      for (const f of block.split("\n").filter(Boolean)) all.add(f);
    }
    return [...all];
  } catch {
    return [];
  }
}

export function readLoopLimitFromHooksJson(root: string): number | null {
  const file = path.join(root, ".cursor", "hooks.json");
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const cfg = JSON.parse(raw) as { hooks?: { stop?: Array<{ loop_limit?: number }> } };
    const stop = cfg.hooks?.stop;
    if (!stop?.length) return null;
    for (const h of stop) {
      if (typeof h.loop_limit === "number") return h.loop_limit;
    }
    return null;
  } catch {
    return null;
  }
}
