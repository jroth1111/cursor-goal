import path from "node:path";
import { extractWorkUnitId, findUnitById, isUnitEvidencePath, readWorkUnits } from "./work-units.js";
import type { WriteGateResult } from "./write-gate.js";

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function pathInUnitScope(
  filePath: string,
  unitScope: string[],
  unitId: string,
): boolean {
  const norm = normalizePath(filePath);
  if (norm.includes(`evidence/units/${unitId}`)) return true;
  if (unitScope.length === 0) return true;
  return unitScope.some((p) => {
    if (p === "**") return true;
    const prefix = p.endsWith("/") ? p : `${p.replace(/\/?$/, "")}/`;
    return norm === p.replace(/\/$/, "") || norm.startsWith(prefix) || norm.startsWith(p);
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

  if (isUnitEvidencePath(filePath, unitId)) {
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

  if (pathInUnitScope(filePath, unit.scope, unit.id)) {
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
  const fromInput =
    extractWorkUnitId(JSON.stringify(input.tool_input ?? {})) ??
    (typeof input.work_unit_id === "string" ? input.work_unit_id : null) ??
    extractWorkUnitId(JSON.stringify(input));
  if (fromInput) return fromInput;
  const unitFromPath = filePath.match(/evidence\/units\/([a-z0-9][a-z0-9_-]*)/i);
  return unitFromPath?.[1] ?? null;
}
