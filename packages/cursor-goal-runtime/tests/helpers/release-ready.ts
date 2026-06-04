import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { markUnitDone } from "../../src/lib/work-units.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

/** Minimal artifacts so runtime stop can RELEASE (I21 phase gate). */
export async function seedReleaseReady(dir: string): Promise<void> {
  await compileGoalV2(dir);
  await writeFile(
    path.join(dir, ".cursor/goal/trajectory.json"),
    JSON.stringify({ phase: "VERIFY" }),
    "utf8",
  );
  await writeFile(
    path.join(dir, ".cursor/goal/discovery.json"),
    JSON.stringify({ completed: true, notes: "ok" }),
    "utf8",
  );
}

export async function writePassingUnitEvidence(dir: string, unitId: string): Promise<void> {
  const evidenceDir = path.join(dir, ".cursor/goal/evidence/units");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, `${unitId}.jsonl`),
    `${JSON.stringify({
      at: new Date().toISOString(),
      evidence_version: 1,
      work_unit_id: unitId,
      acceptance_ok: true,
      subagent_status: "completed",
      status: "passed",
    })}\n`,
    "utf8",
  );
}

export async function markUnitDoneWithEvidence(unitId: string, dir: string): Promise<void> {
  await writePassingUnitEvidence(dir, unitId);
  await markUnitDone(unitId, dir);
}
