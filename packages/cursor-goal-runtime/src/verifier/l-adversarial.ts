import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import {
  unitDeliverablePath,
  unitVerifierResultPath,
  unitsRequiringAdversarial,
} from "../lib/adversarial-paths.js";
import { readWorkUnits } from "../lib/work-units.js";
import type { VerifierContext } from "./types.js";

export type AdversarialGateResult = {
  blocked: boolean;
  message?: string;
};

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

export async function levelAdversarialBlocked(
  ctx: VerifierContext,
): Promise<AdversarialGateResult> {
  const file = await readWorkUnits(ctx.root);
  if (!file?.units?.length) return { blocked: false };

  const required = unitsRequiringAdversarial(file.units);
  if (!required.length) return { blocked: false };

  const missing: string[] = [];
  const failed: string[] = [];

  for (const unit of required) {
    const deliverable = unitDeliverablePath(ctx.root, unit.id);
    if (!existsSync(deliverable)) {
      missing.push(unit.id);
      ctx.failures.push(`adversarial-missing-deliverable: ${unit.id}`);
      continue;
    }

    const resultPath = unitVerifierResultPath(ctx.root, unit.id);
    if (!existsSync(resultPath)) {
      missing.push(unit.id);
      ctx.failures.push(`adversarial-missing-verdict: ${unit.id}`);
      continue;
    }

    if (!(await isFreshVerifierResult(ctx.root, unit.id, deliverable))) {
      ctx.failures.push(`adversarial-stale-verdict: ${unit.id}`);
      missing.push(unit.id);
      continue;
    }

    try {
      const raw = await readFile(resultPath, "utf8");
      const data = JSON.parse(raw) as { passed?: boolean; summary?: string };
      if (data.passed !== true) {
        failed.push(unit.id);
        ctx.failures.push(
          `adversarial-verdict-fail: ${unit.id}${data.summary ? ` — ${data.summary}` : ""}`,
        );
      }
    } catch {
      ctx.failures.push(`adversarial-invalid-verdict: ${unit.id}`);
      missing.push(unit.id);
    }
  }

  if (missing.length || failed.length) {
    const parts: string[] = [];
    if (missing.length) {
      parts.push(
        `Missing deliverable or VERDICT:PASS for unit(s) ${missing.join(", ")}. ` +
          `Run: cursor-goal dispatch --verify --unit <id>`,
      );
    }
    if (failed.length) {
      parts.push(`Verifier FAIL for unit(s) ${failed.join(", ")} — fix and re-verify.`);
    }
    return { blocked: true, message: parts.join(" ") };
  }

  return { blocked: false };
}
