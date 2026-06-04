import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import { unitDeliverablePath, unitVerifierResultPath } from "./adversarial-paths.js";

export type AdversarialUnitStatus =
  | { ok: true }
  | {
      ok: false;
      code:
        | "missing-deliverable"
        | "missing-verdict"
        | "stale-verdict"
        | "verdict-fail"
        | "invalid-verdict";
      reason: string;
      hint?: string;
    };

export function unitRequiresAdversarial(unit: WorkUnitCompiled): boolean {
  return Boolean(unit.verified_by?.trim());
}

async function isFreshVerifierResult(
  root: string,
  unitId: string,
  deliverablePath: string,
): Promise<boolean> {
  const resultPath = unitVerifierResultPath(root, unitId);
  if (!existsSync(resultPath)) return false;
  try {
    const [rStat, dStat] = await Promise.all([stat(resultPath), stat(deliverablePath)]);
    return rStat.mtimeMs >= dStat.mtimeMs;
  } catch {
    return false;
  }
}

/** Deliverable + fresh VERDICT:PASS for units with verified_by. */
export async function unitAdversarialStatus(
  root: string,
  unit: WorkUnitCompiled,
): Promise<AdversarialUnitStatus> {
  if (!unitRequiresAdversarial(unit)) return { ok: true };

  const deliverable = unitDeliverablePath(root, unit.id);
  if (!existsSync(deliverable)) {
    return {
      ok: false,
      code: "missing-deliverable",
      reason: `missing deliverable for unit "${unit.id}"`,
      hint: `cursor-goal dispatch --verify --unit ${unit.id}`,
    };
  }

  const resultPath = unitVerifierResultPath(root, unit.id);
  if (!existsSync(resultPath)) {
    return {
      ok: false,
      code: "missing-verdict",
      reason: `missing VERDICT for unit "${unit.id}"`,
      hint: `cursor-goal dispatch --verify --unit ${unit.id}`,
    };
  }

  if (!(await isFreshVerifierResult(root, unit.id, deliverable))) {
    return {
      ok: false,
      code: "stale-verdict",
      reason: `stale verifier result for unit "${unit.id}"`,
      hint: `cursor-goal dispatch --verify --unit ${unit.id}`,
    };
  }

  try {
    const raw = await readFile(resultPath, "utf8");
    const data = JSON.parse(raw) as { passed?: boolean; summary?: string };
    if (data.passed !== true) {
      return {
        ok: false,
        code: "verdict-fail",
        reason: `verifier FAIL for unit "${unit.id}"${data.summary ? ` — ${data.summary}` : ""}`,
        hint: `cursor-goal dispatch --verify --unit ${unit.id}`,
      };
    }
  } catch {
    return {
      ok: false,
      code: "invalid-verdict",
      reason: `invalid verifier result for unit "${unit.id}"`,
      hint: `cursor-goal dispatch --verify --unit ${unit.id}`,
    };
  }

  return { ok: true };
}
