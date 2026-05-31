import path from "node:path";
import { atomicWriteJson, goalDir, projectRoot, readJson } from "../lib/paths.js";
import { gitTreeId } from "../lib/git-state.js";

export type Phase = "INTAKE" | "DISCOVERY" | "PLAN" | "IMPLEMENT" | "VERIFY" | "DONE";

const ORDER: Phase[] = ["INTAKE", "DISCOVERY", "PLAN", "IMPLEMENT", "VERIFY", "DONE"];

const VALID_PHASES = new Set<Phase>(ORDER);

function normalizePhase(value: unknown): Phase {
  if (typeof value === "string" && VALID_PHASES.has(value as Phase)) {
    return value as Phase;
  }
  return "DISCOVERY";
}

const TRANSITIONS: Record<Phase, Phase[]> = {
  INTAKE: ["DISCOVERY"],
  DISCOVERY: ["PLAN", "IMPLEMENT"],
  PLAN: ["IMPLEMENT"],
  IMPLEMENT: ["VERIFY"],
  VERIFY: ["DONE", "IMPLEMENT"],
  DONE: [],
};

export type Trajectory = {
  phase: Phase;
  sliceBudget?: number;
  discovery_completed_at?: string;
  updated_at?: string;
};

export async function readTrajectory(root?: string): Promise<Trajectory> {
  const t = await readJson<Trajectory>(path.join(goalDir(root), "trajectory.json"));
  return {
    ...t,
    phase: normalizePhase(t?.phase),
    sliceBudget: t?.sliceBudget,
    discovery_completed_at: t?.discovery_completed_at,
    updated_at: t?.updated_at,
  };
}

export async function writeTrajectory(traj: Trajectory, root?: string): Promise<void> {
  await atomicWriteJson(path.join(goalDir(root), "trajectory.json"), {
    ...traj,
    phase: normalizePhase(traj.phase),
    updated_at: new Date().toISOString(),
  });
}

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function advancePhase(to: Phase, root?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const traj = await readTrajectory(root);
  if (!canTransition(traj.phase, to)) {
    return { ok: false, error: `Cannot transition ${traj.phase} → ${to}` };
  }
  if (to === "IMPLEMENT") {
    const disc = await readJson<{ completed?: boolean }>(
      path.join(goalDir(root), "discovery.json"),
    );
    if (!disc?.completed) {
      return { ok: false, error: "discovery.json not completed; finish DISCOVERY first" };
    }
  }
  const next: Trajectory = { ...traj, phase: to };
  if (to === "DISCOVERY" && traj.phase === "INTAKE") {
    next.discovery_completed_at = undefined;
  }
  await writeTrajectory(next, root);
  return { ok: true };
}

export async function completeDiscovery(
  notes: string,
  root?: string,
  opts?: { planOnly?: boolean },
): Promise<void> {
  await atomicWriteJson(path.join(goalDir(root), "discovery.json"), {
    completed: true,
    notes,
    completed_at: new Date().toISOString(),
  });
  const r = root ?? undefined;
  await captureTargetSnapshot(r);
  const traj = await readTrajectory(r);
  if (traj.phase === "DISCOVERY" || traj.phase === "INTAKE") {
    const nextPhase = opts?.planOnly ? "PLAN" : "IMPLEMENT";
    await writeTrajectory(
      {
        ...traj,
        phase: nextPhase,
        discovery_completed_at: new Date().toISOString(),
      },
      r,
    );
  }
}

export async function captureTargetSnapshot(root?: string): Promise<void> {
  const r = root ?? projectRoot();
  const tree = gitTreeId(r);
  const intent = await readJson<{ goal?: string }>(path.join(goalDir(r), "intent.json"));
  const goal = intent?.goal ?? "";
  const hash = Buffer.from(goal).toString("base64url").slice(0, 16);
  await atomicWriteJson(path.join(goalDir(r), "target-snapshot.json"), {
    tree_id: tree,
    goal_summary_hash: hash,
    files: [],
    captured_at: new Date().toISOString(),
  });
}

export function isTerminalPhase(phase: Phase): boolean {
  return phase === "DONE" || phase === "VERIFY";
}

export function phaseIndex(p: Phase): number {
  return ORDER.indexOf(p);
}

export async function maybeAutoAdvanceToVerify(root?: string): Promise<Phase | null> {
  const traj = await readTrajectory(root);
  if (traj.phase !== "IMPLEMENT") return null;
  const { readWorkUnits, allUnitsDone } = await import("../lib/work-units.js");
  const wu = await readWorkUnits(root);
  if (!wu?.units?.length) return null;
  if (!allUnitsDone(wu.units)) return null;
  const r = await advancePhase("VERIFY", root);
  if (!r.ok) return null;
  return "VERIFY";
}
