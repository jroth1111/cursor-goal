import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import { goalDir } from "./paths.js";
import { subagentStatusOk } from "./subagent-status.js";

export type UnitEvidenceRecord = Record<string, unknown>;

export type UnitCompletionEvidence = {
  ok: boolean;
  reason?: string;
  record?: UnitEvidenceRecord;
};

const FAILURE_STATUSES = new Set([
  "failed",
  "blocked",
  "cancelled",
  "canceled",
  "error",
  "timeout",
  "aborted",
]);
const MALFORMED_EVIDENCE = "__cursor_goal_malformed_latest";
const INVALID_EVIDENCE_PATH = "__cursor_goal_invalid_evidence_path";

export function legacyEvidenceAllowed(): boolean {
  return process.env.CURSOR_GOAL_LEGACY_EVIDENCE === "1";
}

export function expectedUnitEvidencePath(unit: Pick<WorkUnitCompiled, "id">): string {
  return `evidence/units/${unit.id}.jsonl`;
}

export function unitEvidencePathError(
  unit: Pick<WorkUnitCompiled, "id" | "evidence_path">,
): string | null {
  const expected = expectedUnitEvidencePath(unit);
  if (unit.evidence_path !== expected) {
    return `Work unit "${unit.id}" evidence_path must be "${expected}"`;
  }
  const normalized = path.posix.normalize(unit.evidence_path.replace(/\\/g, "/"));
  if (normalized !== expected) {
    return `Work unit "${unit.id}" evidence_path must stay inside evidence/units`;
  }
  return null;
}

export function unitEvidencePath(root: string, unit: WorkUnitCompiled): string {
  const evidencePath = unitEvidencePathError(unit)
    ? expectedUnitEvidencePath(unit)
    : unit.evidence_path;
  return path.join(goalDir(root), evidencePath);
}

function displayEvidencePath(unit: WorkUnitCompiled): string {
  return `.cursor/goal/${unit.evidence_path}`;
}

export async function readLatestUnitEvidence(
  root: string,
  unit: WorkUnitCompiled,
): Promise<UnitEvidenceRecord | null> {
  const pathError = unitEvidencePathError(unit);
  if (pathError) return { [INVALID_EVIDENCE_PATH]: pathError };
  const file = unitEvidencePath(root, unit);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as UnitEvidenceRecord;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      if (legacyEvidenceAllowed()) return {};
      return { [MALFORMED_EVIDENCE]: true };
    } catch {
      if (legacyEvidenceAllowed()) return {};
      return { [MALFORMED_EVIDENCE]: true };
    }
  }
  return null;
}

function evidenceBlockReason(unit: WorkUnitCompiled, record: UnitEvidenceRecord): string | null {
  const invalidPath = record[INVALID_EVIDENCE_PATH];
  if (typeof invalidPath === "string") return invalidPath;
  if (record[MALFORMED_EVIDENCE] === true) {
    return `Latest evidence for "${unit.id}" is malformed`;
  }
  const id = record.work_unit_id;
  if (typeof id === "string" && id !== unit.id) {
    return `Evidence work_unit_id "${id}" does not match unit "${unit.id}"`;
  }
  if (record.blocked === true || record.ok === false) {
    const blocker = record.blocker;
    return typeof blocker === "string" && blocker.trim()
      ? blocker
      : `Latest evidence for "${unit.id}" is blocked or failed`;
  }
  const status =
    typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  if (FAILURE_STATUSES.has(status)) {
    const blocker = record.blocker;
    return typeof blocker === "string" && blocker.trim()
      ? blocker
      : `Latest evidence for "${unit.id}" has status "${status}"`;
  }
  if (record.evidence_version === 1) {
    if (typeof record.at !== "string" || !record.at.trim()) {
      return `Unit evidence for "${unit.id}" missing timestamp`;
    }
    if (record.acceptance_ok !== true) {
      return `Unit evidence for "${unit.id}" requires acceptance_ok: true`;
    }
    if (typeof record.subagent_status === "string" && !subagentStatusOk(record.subagent_status)) {
      return `Unit evidence for "${unit.id}" has non-success subagent_status`;
    }
    return null;
  }
  if (legacyEvidenceAllowed()) {
    if (status === "blocked") {
      return `Latest evidence for "${unit.id}" is blocked or failed`;
    }
    return null;
  }
  return `Unit evidence for "${unit.id}" requires evidence_version: 1 (set CURSOR_GOAL_LEGACY_EVIDENCE=1 for legacy)`;
}

export async function checkUnitCompletionEvidence(
  root: string,
  unit: WorkUnitCompiled,
): Promise<UnitCompletionEvidence> {
  const pathError = unitEvidencePathError(unit);
  if (pathError) return { ok: false, reason: pathError };
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
