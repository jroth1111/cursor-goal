import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import {
  cleanWorkUnitId,
  findUnitById,
  isUnitEvidencePath,
  readWorkUnits,
  structuredWorkUnitId,
} from "./work-units.js";
import type { WriteGateResult } from "./write-gate.js";

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.replace(/\\/g, "/"));
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

function canonicalPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  if (!path.isAbsolute(normalized)) return normalized;
  return canonicalAbsolutePath(normalized);
}

function relativePathForScope(filePath: string, root?: string): string | null {
  const norm = canonicalPath(filePath);
  if (!root) return norm;
  const rootNorm = canonicalAbsolutePath(root);
  if (path.posix.isAbsolute(norm)) {
    if (norm === rootNorm) return ".";
    if (norm.startsWith(`${rootNorm}/`)) return norm.slice(rootNorm.length + 1);
    return null;
  }
  if (norm === ".." || norm.startsWith("../")) return null;
  return norm;
}

export function pathInUnitScope(
  filePath: string,
  unitScope: string[],
  unitId: string,
): boolean {
  const norm = normalizePath(filePath);
  if (isUnitEvidencePath(norm, unitId)) return true;
  if (unitScope.length === 0) return true;
  return unitScope.some((p) => {
    if (p === "**") return true;
    const base = normalizePath(p).replace(/\/+$/, "");
    if (base === "." || base === "") return true;
    return norm === base || norm.startsWith(`${base}/`);
  });
}

export async function checkSubagentWriteGate(
  filePath: string,
  unitId: string | null,
  root?: string,
): Promise<WriteGateResult> {
  if (!filePath) return { allowed: true };
  if (!unitId) {
    return {
      allowed: false,
      reason:
        "Subagent WriteGate: missing work_unit_id — cannot verify unit scope",
    };
  }

  const scopePath = relativePathForScope(filePath, root);
  if (!scopePath) {
    return {
      allowed: false,
      reason: `Subagent WriteGate: ${filePath} outside project root`,
    };
  }

  if (isUnitEvidencePath(scopePath, unitId)) {
    return { allowed: true };
  }

  const wu = await readWorkUnits(root);
  const unit = wu ? findUnitById(wu.units, unitId) : undefined;
  if (!unit) {
    return {
      allowed: false,
      reason: `Subagent WriteGate: unknown work unit "${unitId}"`,
    };
  }

  if (pathInUnitScope(scopePath, unit.scope, unit.id)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Subagent WriteGate: ${filePath} outside unit "${unitId}" scope [${unit.scope.join(", ")}]`,
  };
}

export function resolveSubagentUnitId(
  input: Record<string, unknown>,
  filePath: string,
): string | null {
  const fromInput = structuredWorkUnitId(input);
  if (fromInput) return fromInput;
  const unitFromPath = filePath.match(/evidence\/units\/([a-z0-9][a-z0-9_-]*)/i);
  return cleanWorkUnitId(unitFromPath?.[1]);
}
