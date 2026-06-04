import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir, goalMd, readJson } from "./paths.js";
import { resolveQueueHead } from "./dispatch-queue.js";
import { readRepoRuntimeSummary } from "./runtime-state.js";
import { pendingUnits, readWorkUnits } from "./work-units.js";
import { readSessionMode } from "./governance-config.js";

function truncateGoal(text: string, max = 120): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

export async function formatGovernedSubmitHeader(root: string): Promise<string | null> {
  if (!existsSync(goalMd(root))) return null;

  const intent = await readJson<{ goal?: string }>(path.join(goalDir(root), "intent.json")).catch(
    () => null,
  );
  const traj = await readJson<{ phase?: string }>(path.join(goalDir(root), "trajectory.json")).catch(
    () => null,
  );
  const wu = await readWorkUnits(root);
  const units = wu?.units ?? [];
  const open = pendingUnits(units);
  const total = units.length;
  const openCount = open.length;

  const resolved = await resolveQueueHead(root);
  const headId = resolved?.item.unit_id ?? open[0]?.id;

  const summary = await readRepoRuntimeSummary(root);
  const loopLine =
    summary != null
      ? `${summary.total_blocked_stops}/${summary.loop_limit}`
      : "—";

  const phase = traj?.phase ?? "DISCOVERY";
  const goalLine = truncateGoal(intent?.goal ?? "See GOAL.md");
  const unitLine =
    total === 0
      ? "Units: (none compiled)"
      : `Units open: ${openCount}/${total}${headId ? ` (head: ${headId})` : ""}`;

  const paused = existsSync(path.join(goalDir(root), "PAUSED")) ? " | PAUSED" : "";
  const session = await readSessionMode(root).catch(() => null);
  const effective = session?.effective_mode ?? session?.mode ?? "governed";
  const hint = session?.interaction_mode_hint ?? (effective === "governed" ? "delivery" : "chat");

  return [
    `Goal: ${goalLine}`,
    `Phase: ${phase} | ${unitLine} | Loop: ${loopLine} | Mode: effective=${effective} hint=${hint} | Mode: governed${paused}`,
  ].join("\n");
}
