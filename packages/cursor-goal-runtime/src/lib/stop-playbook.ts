import type { Phase } from "../trajectory/fsm.js";
import { readWorkUnits, pendingUnits } from "./work-units.js";

export { buildUnitTaskPrompt } from "./unit-task-prompt.js";

export async function sessionBrief(root: string, phase: Phase): Promise<string> {
  const wu = await readWorkUnits(root);
  const open = wu ? pendingUnits(wu.units).length : 0;
  const total = wu?.units?.length ?? 0;
  if (total === 0) return `cursor-goal: phase=${phase}`;
  return `cursor-goal: phase=${phase}, work_units=${total - open}/${total} done`;
}
