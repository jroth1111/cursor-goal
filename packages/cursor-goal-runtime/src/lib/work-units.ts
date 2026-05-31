import { existsSync } from "node:fs";
import path from "node:path";
import { withGoalDirLock } from "./goal-dir-lock.js";
import { atomicWriteJson, goalDir, projectRoot, readJson } from "./paths.js";
import { syncDispatchQueueHeadIndex } from "./dispatch-queue.js";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";

export type WorkUnitsFile = { units: WorkUnitCompiled[] };

export async function readWorkUnits(root?: string): Promise<WorkUnitsFile | null> {
  return readJson<WorkUnitsFile>(path.join(goalDir(root), "work-units.json"));
}

export async function writeWorkUnits(data: WorkUnitsFile, root?: string): Promise<void> {
  const r = root ?? projectRoot();
  await withGoalDirLock(r, async () => {
    await atomicWriteJson(path.join(goalDir(r), "work-units.json"), data);
  });
}

async function mutateWorkUnits(
  root: string | undefined,
  mutator: (file: WorkUnitsFile) => boolean,
): Promise<boolean> {
  const r = root ?? projectRoot();
  let ok = false;
  await withGoalDirLock(r, async () => {
    const file = await readJson<WorkUnitsFile>(path.join(goalDir(r), "work-units.json"));
    if (!file) return;
    if (!mutator(file)) return;
    await atomicWriteJson(path.join(goalDir(r), "work-units.json"), file);
    ok = true;
  });
  return ok;
}

export function allUnitsDone(units: WorkUnitCompiled[]): boolean {
  if (units.length === 0) return true;
  return units.every((u) => u.status === "done");
}

export function pendingUnits(units: WorkUnitCompiled[]): WorkUnitCompiled[] {
  return units.filter((u) => u.status !== "done");
}

export function findUnitBySubagent(
  units: WorkUnitCompiled[],
  subagentId: string,
): WorkUnitCompiled | undefined {
  return units.find((u) => u.subagent_id === subagentId);
}

export function findUnitById(
  units: WorkUnitCompiled[],
  id: string,
): WorkUnitCompiled | undefined {
  return units.find((u) => u.id === id);
}

export async function markUnitInProgress(
  unitId: string,
  subagentId: string,
  root?: string,
): Promise<boolean> {
  const r = root ?? projectRoot();
  const ok = await mutateWorkUnits(r, (file) => {
    const unit = findUnitById(file.units, unitId);
    if (!unit) return false;
    const conflict = file.units.find(
      (u) => u.id !== unitId && u.status === "in_progress" && u.subagent_id === subagentId,
    );
    if (conflict) return false;
    const busy = file.units.find((u) => u.id === unitId && u.status === "in_progress");
    if (busy && busy.subagent_id !== subagentId) return false;
    unit.status = "in_progress";
    unit.subagent_id = subagentId;
    return true;
  });
  if (ok) await syncDispatchQueueHeadIndex(r).catch(() => undefined);
  return ok;
}

export async function markUnitEvidence(
  unitId: string,
  subagentId: string,
  root?: string,
): Promise<void> {
  const r = root ?? projectRoot();
  const ok = await mutateWorkUnits(r, (file) => {
    const unit = findUnitById(file.units, unitId);
    if (!unit) return false;
    unit.subagent_id = subagentId;
    if (unit.status !== "done") unit.status = "evidence_received";
    return true;
  });
  if (ok) await syncDispatchQueueHeadIndex(r).catch(() => undefined);
}

export async function markUnitDone(unitId: string, root?: string): Promise<boolean> {
  const r = root ?? projectRoot();
  const ok = await mutateWorkUnits(r, (file) => {
    const unit = findUnitById(file.units, unitId);
    if (!unit) return false;
    unit.status = "done";
    return true;
  });
  if (ok) await syncDispatchQueueHeadIndex(r).catch(() => undefined);
  return ok;
}

export function isSubagentContext(input: Record<string, unknown>): boolean {
  if (input.is_subagent === true) return true;
  if (typeof input.subagent_id === "string" && input.subagent_id) return true;
  if (typeof input.agent === "string" && input.agent !== "default") return true;
  return false;
}

export function pathTouchesGoalGovernance(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  if (!norm.includes(".cursor/goal")) return false;
  if (norm.includes("evidence/units/")) return false;
  return true;
}

export function isUnitEvidencePath(filePath: string, unitId: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  return new RegExp(`(^|/)evidence/units/${unitId}\\.jsonl$`, "i").test(norm);
}

export function extractWorkUnitId(text: string): string | null {
  const m =
    text.match(/work_unit_id\s*[:=]\s*["']?([a-z0-9][a-z0-9_-]*)/i) ??
    text.match(/\[work-unit:([a-z0-9][a-z0-9_-]*)\]/i);
  return m?.[1] ?? null;
}

export { dispositionWaivesUnits } from "./disposition.js";
