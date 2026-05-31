import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import { goalDir } from "./paths.js";

export type UnitEvidenceRecord = Record<string, unknown>;

export type UnitCompletionEvidence = {
  ok: boolean;
  reason?: string;
  record?: UnitEvidenceRecord;
};

export function unitEvidencePath(root: string, unit: WorkUnitCompiled): string {
  return path.join(goalDir(root), unit.evidence_path);
}

function displayEvidencePath(unit: WorkUnitCompiled): string {
  return `.cursor/goal/${unit.evidence_path}`;
}

export async function readLatestUnitEvidence(
  root: string,
  unit: WorkUnitCompiled,
): Promise<UnitEvidenceRecord | null> {
  const file = unitEvidencePath(root, unit);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as UnitEvidenceRecord;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      /* Non-JSON evidence remains acceptable for legacy/manual evidence files. */
      return {};
    }
  }
  return null;
}

function evidenceBlockReason(unit: WorkUnitCompiled, record: UnitEvidenceRecord): string | null {
  const id = record.work_unit_id;
  if (typeof id === "string" && id !== unit.id) {
    return `Evidence work_unit_id "${id}" does not match unit "${unit.id}"`;
  }
  if (record.blocked === true || record.ok === false || record.status === "blocked") {
    const blocker = record.blocker;
    return typeof blocker === "string" && blocker.trim()
      ? blocker
      : `Latest evidence for "${unit.id}" is blocked or failed`;
  }
  return null;
}

export async function checkUnitCompletionEvidence(
  root: string,
  unit: WorkUnitCompiled,
): Promise<UnitCompletionEvidence> {
  const file = unitEvidencePath(root, unit);
  if (!existsSync(file)) {
    return {
      ok: false,
      reason: `Missing unit evidence: ${displayEvidencePath(unit)}`,
    };
  }
  const record = await readLatestUnitEvidence(root, unit);
  if (!record) {
    return {
      ok: false,
      reason: `Unit evidence is empty: ${displayEvidencePath(unit)}`,
    };
  }
  const blocked = evidenceBlockReason(unit, record);
  if (blocked) return { ok: false, reason: blocked, record };
  return { ok: true, record };
}

export async function readBlockedUnitEvidence(
  root: string,
  unit: WorkUnitCompiled,
): Promise<UnitCompletionEvidence | null> {
  const record = await readLatestUnitEvidence(root, unit);
  if (!record) return null;
  const blocked = evidenceBlockReason(unit, record);
  if (!blocked) return null;
  return { ok: false, reason: blocked, record };
}
