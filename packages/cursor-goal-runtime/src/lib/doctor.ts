import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir, goalMd, projectRoot } from "./paths.js";
import { auditGoalAlignment } from "./goal-alignment.js";
import { cursorHome } from "./template.js";

export type DoctorIssue = { level: "error" | "warn"; message: string };

export function resolveRuntimeRoot(root: string): string | null {
  if (
    process.env.CURSOR_GOAL_RUNTIME &&
    existsSync(path.join(process.env.CURSOR_GOAL_RUNTIME, "dist/hook-stop.mjs"))
  ) {
    return process.env.CURSOR_GOAL_RUNTIME;
  }
  for (const p of [
    path.join(cursorHome(), "cursor-goal-runtime"),
    path.join(root, "packages/cursor-goal-runtime"),
    path.join(root, "node_modules/@cursor-goal/runtime"),
  ]) {
    if (existsSync(path.join(p, "dist/hook-stop.mjs"))) return p;
  }
  return null;
}

export function hasProjectHooks(root: string): boolean {
  return existsSync(path.join(root, ".cursor/hooks/goal-stop.sh"));
}

export function hasGlobalHooks(): boolean {
  return existsSync(path.join(cursorHome(), "hooks/goal-stop.sh"));
}

export async function runDoctor(root = projectRoot()): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const projectHooks = hasProjectHooks(root);
  const globalHooks = hasGlobalHooks();

  if (!projectHooks && !globalHooks) {
    issues.push({
      level: "error",
      message:
        "Hooks missing — run: npm run install:global (or bash core/install.sh for per-repo hooks)",
    });
  } else if (globalHooks && !existsSync(path.join(cursorHome(), "cursor-goal-runtime/dist/hook-stop.mjs"))) {
    issues.push({
      level: "error",
      message: "Global runtime missing — run: npm run install:global",
    });
  }

  if (!resolveRuntimeRoot(root)) {
    issues.push({
      level: "error",
      message: "Runtime not built — run: npm run install:global or npm run build",
    });
  }
  if (!existsSync(goalMd(root))) {
    issues.push({ level: "warn", message: "GOAL.md missing — will auto-init on first session in git repos" });
  }
  if (!existsSync(path.join(goalDir(root), "manifest.json"))) {
    issues.push({ level: "warn", message: "Not compiled — run: cursor-goal compile" });
  }
  for (const stale of ["NEXT_UNIT.md", "LAST_CHECK_FAIL.md"]) {
    if (existsSync(path.join(goalDir(root), stale))) {
      issues.push({
        level: "warn",
        message: `Remove deprecated ${stale} — orchestration is in runtime-state.json`,
      });
    }
  }
  if (existsSync(goalMd(root))) {
    try {
      issues.push(...(await auditGoalAlignment(root)));
    } catch {
      issues.push({ level: "warn", message: "GOAL alignment audit failed — run: cursor-goal doctor" });
    }
  }
  return issues;
}
