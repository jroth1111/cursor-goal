import { atomicWriteJson, goalDir, readJson } from "./paths.js";
import { readWorkUnits } from "./work-units.js";
import { runUnitAcceptance } from "./unit-acceptance.js";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";

export type UnitAcceptanceSnapshot = {
  at: string;
  units: Array<{ unit_id: string; acceptance_ok: boolean; role: string }>;
};

export function acceptanceProbeEnabled(): boolean {
  const raw = process.env.CURSOR_GOAL_ACCEPTANCE_PROBE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function writeUnitAcceptanceSnapshot(root: string): Promise<void> {
  if (!acceptanceProbeEnabled()) return;
  const wu = await readWorkUnits(root);
  if (!wu?.units.length) return;

  const units: UnitAcceptanceSnapshot["units"] = [];
  for (const unit of wu.units) {
    if (unit.status === "done") continue;
    const acc = await runUnitAcceptance(unit, root);
    units.push({
      unit_id: unit.id,
      acceptance_ok: acc.ok,
      role: unit.role ?? "implement",
    });
  }

  await atomicWriteJson(pathJoin(root), {
    at: new Date().toISOString(),
    units,
  });
}

function pathJoin(root: string): string {
  return `${goalDir(root)}/unit-acceptance-snapshot.json`;
}

export async function readUnitAcceptanceSnapshot(
  root: string,
): Promise<UnitAcceptanceSnapshot | null> {
  return readJson<UnitAcceptanceSnapshot>(pathJoin(root)).catch(() => null);
}

export async function acceptancePreflightForOpenUnits(
  root: string,
): Promise<Record<string, boolean>> {
  const snap = await readUnitAcceptanceSnapshot(root);
  const map: Record<string, boolean> = {};
  if (snap?.units) {
    for (const row of snap.units) {
      map[row.unit_id] = row.acceptance_ok;
    }
    return map;
  }
  const wu = await readWorkUnits(root);
  if (!wu) return map;
  for (const unit of wu.units) {
    if (unit.status === "done") continue;
    const acc = await runUnitAcceptance(unit, root);
    map[unit.id] = acc.ok;
  }
  return map;
}
