import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import { resolveQueueHead } from "./dispatch-queue.js";
import { buildUnitTaskPrompt } from "./unit-task-prompt.js";
import { findUnitById, pendingUnits, readWorkUnits } from "./work-units.js";
import { projectRoot } from "./paths.js";

export type DispatchHead = {
  unit: WorkUnitCompiled;
  taskPrompt: string;
  queueIndex: number;
};

export async function resolveDispatchHead(root?: string): Promise<DispatchHead | null> {
  const r = root ?? projectRoot();
  const wu = await readWorkUnits(r);
  if (!wu) return null;
  const open = pendingUnits(wu.units);
  if (open.length === 0) return null;

  const head = await resolveQueueHead(r);
  const unit =
    (head ? findUnitById(open, head.item.unit_id) : undefined) ??
    open.find((u) => u.status === "pending") ??
    open[0];

  return {
    unit,
    taskPrompt: buildUnitTaskPrompt(unit),
    queueIndex: head?.index ?? 0,
  };
}

export function formatDispatchInstruction(head: DispatchHead): string {
  const lines = [
    `Dispatch work unit "${head.unit.id}" (queue ${head.queueIndex + 1})`,
    "",
    "Spawn one Task/subagent with this prompt, or run: cursor-goal dispatch --run",
    "",
    head.taskPrompt,
  ];
  return lines.join("\n");
}
