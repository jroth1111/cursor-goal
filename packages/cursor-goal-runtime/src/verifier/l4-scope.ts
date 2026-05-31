import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { goalDir } from "../lib/paths.js";
import { listDiffFiles } from "../lib/git-state.js";
import type { VerifierContext } from "./types.js";

export function levelScope(ctx: VerifierContext): void {
  const scopeFile = path.join(goalDir(ctx.root), "scope.json");
  if (!existsSync(scopeFile)) return;

  const scope = JSON.parse(readFileSync(scopeFile, "utf8")) as {
    paths?: string[];
    enforce?: boolean;
  };
  if (!scope.paths?.length || scope.enforce === false) return;

  const bad: string[] = [];
  for (const f of listDiffFiles(ctx.root)) {
    if (f === "GOAL.md" || f.startsWith(".cursor/goal/")) continue;
    const ok = scope.paths.some((p) => {
      if (p === "**") return true;
      if (p === "." || p === "./") return true;
      const prefix = p.endsWith("/") ? p : `${p}/`;
      return f === p || f.startsWith(prefix);
    });
    if (!ok) bad.push(f);
  }
  if (bad.length) {
    ctx.failures.push(`out-of-scope: ${bad.join(", ")}`);
  }
}
