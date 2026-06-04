import { existsSync } from "node:fs";
import path from "node:path";
import type { CompiledArtifacts, WorkUnitCompiled } from "../compile/compile-v2.js";
import { goalDir, readJson } from "./paths.js";
import { parseGoalMd } from "./parse-goal-md.js";

export type CompileMaterialFingerprint = {
  goalText: string;
  checks: string[];
  checkTiers: Record<string, "fast" | "full">;
  scopePaths: string[];
  units: Array<{
    id: string;
    title: string;
    scope: string[];
    acceptance: string[];
    role: string;
    verified_by: string | null;
    verify_prompt: string | null;
  }>;
};

function unitFingerprint(u: WorkUnitCompiled): CompileMaterialFingerprint["units"][number] {
  return {
    id: u.id,
    title: u.title,
    scope: [...u.scope],
    acceptance: [...u.acceptance],
    role: u.role,
    verified_by: u.verified_by ?? null,
    verify_prompt: u.verify_prompt ?? null,
  };
}

export function fingerprintFromArtifacts(artifacts: CompiledArtifacts): CompileMaterialFingerprint {
  const tiers = artifacts.checks.tiers ?? {};
  return {
    goalText: String((artifacts.intent as { goal?: string }).goal ?? ""),
    checks: [...artifacts.checks.commands],
    checkTiers: { ...tiers },
    scopePaths: [...artifacts.scope.paths],
    units: artifacts.workUnits.units.map(unitFingerprint),
  };
}

export async function fingerprintFromDisk(root: string): Promise<CompileMaterialFingerprint | null> {
  const gd = goalDir(root);
  const checksPath = path.join(gd, "checks.json");
  const scopePath = path.join(gd, "scope.json");
  const intentPath = path.join(gd, "intent.json");
  const wuPath = path.join(gd, "work-units.json");
  if (!existsSync(checksPath) || !existsSync(wuPath)) return null;

  const checksFile = await readJson<{ commands?: string[]; tiers?: Record<string, "fast" | "full"> }>(
    checksPath,
  ).catch(() => null);
  const scopeFile = await readJson<{ paths?: string[] }>(scopePath).catch(() => null);
  const intentFile = await readJson<{ goal?: string }>(intentPath).catch(() => null);
  const wuFile = await readJson<{ units?: WorkUnitCompiled[] }>(wuPath).catch(() => null);
  if (!checksFile?.commands || !Array.isArray(wuFile?.units)) return null;

  let goalText = intentFile?.goal ?? "";
  if (!goalText) {
    try {
      const parsed = await parseGoalMd(root);
      goalText = parsed.goalText;
    } catch {
      goalText = "";
    }
  }

  return {
    goalText,
    checks: [...checksFile.commands],
    checkTiers: { ...(checksFile.tiers ?? {}) },
    scopePaths: [...(scopeFile?.paths ?? [])],
    units: wuFile.units.map(unitFingerprint),
  };
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameTiers(
  a: Record<string, "fast" | "full">,
  b: Record<string, "fast" | "full">,
): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (!sameStringArray(keysA, keysB)) return false;
  return keysA.every((k) => a[k] === b[k]);
}

export function compileMaterialChanged(
  before: CompileMaterialFingerprint | null,
  after: CompileMaterialFingerprint,
): boolean {
  if (!before) return true;
  if (before.goalText !== after.goalText) return true;
  if (!sameStringArray(before.checks, after.checks)) return true;
  if (!sameTiers(before.checkTiers, after.checkTiers)) return true;
  if (!sameStringArray(before.scopePaths, after.scopePaths)) return true;
  if (before.units.length !== after.units.length) return true;
  const beforeById = new Map(before.units.map((u) => [u.id, u]));
  for (const unit of after.units) {
    const prev = beforeById.get(unit.id);
    if (!prev) return true;
    if (
      prev.title !== unit.title ||
      !sameStringArray(prev.scope, unit.scope) ||
      !sameStringArray(prev.acceptance, unit.acceptance) ||
      prev.role !== unit.role ||
      prev.verified_by !== unit.verified_by ||
      prev.verify_prompt !== unit.verify_prompt
    ) {
      return true;
    }
  }
  return false;
}
