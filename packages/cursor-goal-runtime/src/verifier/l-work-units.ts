import { dispositionWaivesUnits } from "../lib/disposition.js";
import { resolveAgentId } from "../lib/runtime-state.js";
import { allUnitsDone, readWorkUnits } from "../lib/work-units.js";
import { checkUnitCompletionEvidence } from "../lib/unit-evidence.js";
import type { VerifierContext } from "./types.js";

export async function levelWorkUnitsBlocked(ctx: VerifierContext): Promise<boolean> {
  const file = await readWorkUnits(ctx.root);
  if (!file?.units?.length) return false;
  if (await dispositionWaivesUnits(ctx.root, resolveAgentId(ctx.input))) return false;
  if (!allUnitsDone(file.units)) return true;

  for (const unit of file.units) {
    const evidence = await checkUnitCompletionEvidence(ctx.root, unit);
    if (!evidence.ok) {
      const reason = evidence.reason ?? "missing acceptable evidence";
      ctx.failures.push(`work-unit-evidence:${unit.id}: ${reason}`);
      ctx.followupMessage =
        ctx.followupMessage ??
        `Work unit "${unit.id}" is marked done without acceptable evidence: ${reason}`;
      return true;
    }
  }

  return false;
}
