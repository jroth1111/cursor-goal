import path from "node:path";
import { goalDir, readJson } from "./paths.js";
import { parseGoalMd } from "./parse-goal-md.js";

export type WriteGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function relativePathForScope(filePath: string, root?: string): string {
  const norm = normalizePath(filePath);
  if (!root) return norm;
  const rootNorm = normalizePath(path.resolve(root));
  if (norm === rootNorm) return ".";
  if (norm.startsWith(`${rootNorm}/`)) return norm.slice(rootNorm.length + 1);
  return norm;
}

function pathInScope(filePath: string, scopePaths: string[], root?: string): boolean {
  const norm = relativePathForScope(filePath, root);
  if (norm === "GOAL.md" || norm.startsWith(".cursor/goal/")) return true;
  return scopePaths.some((p) => {
    if (p === "**") return true;
    const base = normalizePath(p).replace(/\/+$/, "");
    if (base === "." || base === "") return true;
    return norm === base || norm.startsWith(`${base}/`);
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
  if (pathInScope(filePath, paths, root)) return { allowed: true };

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
