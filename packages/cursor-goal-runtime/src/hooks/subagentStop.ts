import { appendFile } from "node:fs/promises";
import path from "node:path";
import { ensureGoalDirs, goalDir, projectRoot } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import {
  extractWorkUnitId,
  findUnitBySubagent,
  markUnitDone,
  markUnitEvidence,
  readWorkUnits,
  findUnitById,
} from "../lib/work-units.js";
import { runUnitAcceptance } from "../lib/unit-acceptance.js";

const input = await readStdinJson<Record<string, unknown>>();
const root = projectRoot();
await ensureGoalDirs(root);

const subagentId = String(
  input.subagent_id ?? input.agent_id ?? input.conversation_id ?? input.agent ?? "unknown",
);
const status = String(input.status ?? "completed");

await appendFile(
  path.join(goalDir(root), "evidence", "subagents.jsonl"),
  JSON.stringify({ at: new Date().toISOString(), subagent_id: subagentId, ...input }) + "\n",
  "utf8",
);

const promptBlob = JSON.stringify(input);
let unitId =
  extractWorkUnitId(promptBlob) ??
  (typeof input.work_unit_id === "string" ? input.work_unit_id : null);

const wu = await readWorkUnits(root);
if (wu && !unitId) {
  const byAgent = findUnitBySubagent(wu.units, subagentId);
  if (byAgent) unitId = byAgent.id;
  if (!unitId) {
    const inProgress = wu.units.find((u) => u.status === "in_progress");
    if (inProgress) unitId = inProgress.id;
  }
}

if (unitId) {
  await markUnitEvidence(unitId, subagentId, root);
  const evidenceRel = `evidence/units/${unitId}.jsonl`;
  const unit = findUnitById(wu?.units ?? [], unitId);
  let acceptanceOk = true;
  if (unit) {
    const acc = await runUnitAcceptance(unit, root);
    acceptanceOk = acc.ok;
    await appendFile(
      path.join(goalDir(root), evidenceRel),
      JSON.stringify({
        at: new Date().toISOString(),
        subagent_id: subagentId,
        status,
        work_unit_id: unitId,
        acceptance: acc.commands,
        acceptance_ok: acc.ok,
      }) + "\n",
      "utf8",
    );
    if (acc.ok) {
      await markUnitDone(unitId, root);
    }
  } else {
    await appendFile(
      path.join(goalDir(root), evidenceRel),
      JSON.stringify({
        at: new Date().toISOString(),
        subagent_id: subagentId,
        status,
        work_unit_id: unitId,
      }) + "\n",
      "utf8",
    );
  }
  void acceptanceOk;
}

hookJson({});
