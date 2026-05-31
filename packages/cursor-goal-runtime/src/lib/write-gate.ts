import path from "node:path";
import { goalDir, readJson } from "./paths.js";
import { parseGoalMd } from "./parse-goal-md.js";

export type WriteGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function pathInScope(filePath: string, scopePaths: string[]): boolean {
  const norm = normalizePath(filePath);
  if (norm === "GOAL.md" || norm.startsWith(".cursor/goal/")) return true;
  return scopePaths.some((p) => {
    if (p === "**") return true;
    const prefix = p.endsWith("/") ? p : `${p.replace(/\/?$/, "")}/`;
    return norm === p.replace(/\/$/, "") || norm.startsWith(prefix) || norm.startsWith(p);
  });
}

export async function checkWriteGate(
  filePath: string,
  root?: string,
): Promise<WriteGateResult> {
  if (!filePath) return { allowed: true };

  const scopeFile = await readJson<{ paths?: string[]; enforce?: boolean }>(
    path.join(goalDir(root), "scope.json"),
  );
  let paths = scopeFile?.paths ?? [];
  let enforce = scopeFile?.enforce ?? false;

  if (paths.length === 0 && !enforce) {
    const parsed = await parseGoalMd(root);
    paths = parsed.scope;
    enforce = parsed.scope.length > 0;
  }

  if (!enforce || paths.length === 0) return { allowed: true };
  if (pathInScope(filePath, paths)) return { allowed: true };

  return {
    allowed: false,
    reason: `WriteGate: ${filePath} outside scope [${paths.join(", ")}]`,
  };
}

export function checkWriteGateSync(
  filePath: string,
  scopePaths: string[],
  enforce: boolean,
): WriteGateResult {
  if (!filePath || !enforce || scopePaths.length === 0) return { allowed: true };
  if (pathInScope(filePath, scopePaths)) return { allowed: true };
  return {
    allowed: false,
    reason: `WriteGate: ${filePath} outside scope [${scopePaths.join(", ")}]`,
  };
}
