import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { goalDir, readJson } from "./paths.js";

export type WriteGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function canonicalAbsolutePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  let cursor = resolved;
  const suffix: string[] = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return normalizePath(resolved);
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  try {
    return normalizePath(path.join(realpathSync(cursor), ...suffix));
  } catch {
    return normalizePath(resolved);
  }
}

function canonicalScopePath(filePath: string): string {
  const normalized = normalizePath(filePath);
  if (!path.isAbsolute(normalized)) return path.posix.normalize(normalized);
  return canonicalAbsolutePath(normalized);
}

function relativePathForScope(filePath: string, root?: string): string {
  const norm = canonicalScopePath(filePath);
  if (!root) return norm;
  const rootNorm = canonicalAbsolutePath(root);
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

/**
 * Attempt to correct a path that failed the write gate.
 * Returns a corrected relative path if the absolute path can be made scope-relative,
 * or null if no correction is feasible (e.g., truly outside scope).
 */
export function suggestScopeCorrection(
  filePath: string,
  scopePaths: string[],
  root?: string,
): string | null {
  if (!filePath) return null;
  if (scopePaths.length === 0) return null;

  // Try stripping absolute prefix to get root-relative path.
  const norm = canonicalScopePath(filePath);
  if (root) {
    const rootNorm = canonicalAbsolutePath(root);
    if (norm.startsWith(`${rootNorm}/`)) {
      const rel = norm.slice(rootNorm.length + 1);
      // Check if this relative path would be in scope
      if (pathInScope(rel, scopePaths)) return rel;
    }
  }

  // Try stripping leading ./ or redundant segments
  const stripped = normalizePath(filePath).replace(/^\.\//, "");
  if (stripped !== filePath && pathInScope(stripped, scopePaths, root)) {
    return stripped;
  }

  return null;
}
