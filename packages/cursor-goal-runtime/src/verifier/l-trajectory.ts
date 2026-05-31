import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir } from "../lib/paths.js";
import { readTrajectory, type Phase } from "../trajectory/fsm.js";
import type { VerifierContext } from "./types.js";

export async function levelTrajectoryBlocked(
  ctx: VerifierContext,
): Promise<{ blocked: boolean; phase: Phase }> {
  const trajPath = path.join(goalDir(ctx.root), "trajectory.json");
  const traj = await readTrajectory(ctx.root);
  if (!existsSync(trajPath)) {
    return { blocked: true, phase: "DISCOVERY" };
  }
  if (traj.phase === "DISCOVERY" || traj.phase === "INTAKE") {
    return { blocked: true, phase: traj.phase };
  }
  return { blocked: false, phase: traj.phase };
}
