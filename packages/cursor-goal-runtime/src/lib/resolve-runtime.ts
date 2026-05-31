import { existsSync } from "node:fs";
import path from "node:path";
import { cursorHome } from "./template.js";

const STOP_HOOK = "dist/hook-stop.mjs";

export function runtimeCandidates(root: string): string[] {
  const list: string[] = [];
  if (process.env.CURSOR_GOAL_RUNTIME) {
    list.push(process.env.CURSOR_GOAL_RUNTIME);
  }
  list.push(path.join(cursorHome(), "cursor-goal-runtime"));
  list.push(path.join(root, "packages/cursor-goal-runtime"));
  list.push(path.join(root, "node_modules/@cursor-goal/runtime"));
  return list;
}

export function resolveRuntimeRoot(root: string): string | null {
  for (const p of runtimeCandidates(root)) {
    if (existsSync(path.join(p, STOP_HOOK))) return p;
  }
  return null;
}
