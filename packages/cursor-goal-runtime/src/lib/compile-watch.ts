import { watch } from "node:fs";
import { compileGoalV2 } from "../compile/compile-v2.js";
import { goalMd, projectRoot } from "./paths.js";
import { withGoalDirLock } from "./goal-dir-lock.js";

let debounce: ReturnType<typeof setTimeout> | null = null;
let watcher: ReturnType<typeof watch> | null = null;

export function startCompileWatch(root = projectRoot()): void {
  if (watcher) return;
  const file = goalMd(root);
  watcher = watch(file, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        await withGoalDirLock(root, () => compileGoalV2(root));
        console.error("cursor-goal: recompiled GOAL.md");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`cursor-goal compile --watch: ${msg}`);
      }
    }, 500);
  });
  console.error(`Watching ${file} — Ctrl+C to stop`);
}

export function stopCompileWatch(): void {
  if (debounce) clearTimeout(debounce);
  watcher?.close();
  watcher = null;
}
