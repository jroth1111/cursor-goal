import { dispositionWaivesUnits } from "../lib/disposition.js";
import { resolveAgentId } from "../lib/runtime-state.js";
import { allUnitsDone, readWorkUnits } from "../lib/work-units.js";
import type { VerifierContext } from "./types.js";

export async function levelWorkUnitsBlocked(ctx: VerifierContext): Promise<boolean> {
  const file = await readWorkUnits(ctx.root);
  if (!file?.units?.length) return false;
  if (await dispositionWaivesUnits(ctx.root, resolveAgentId(ctx.input))) return false;
  return !allUnitsDone(file.units);
}
