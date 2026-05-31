import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureGoalDirs, goalDir, projectRoot } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import {
  findUnitBySubagent,
  markUnitDone,
  markUnitEvidence,
  readWorkUnits,
  findUnitById,
  structuredWorkUnitId,
} from "../lib/work-units.js";
import { runUnitAcceptance } from "../lib/unit-acceptance.js";
import { subagentStatusOk, subagentStatusBlockedReason } from "../lib/subagent-status.js";

async function main(): Promise<void> {
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

let unitId = structuredWorkUnitId(input);

const wu = await readWorkUnits(root);
if (wu && !unitId) {
  const byAgent = findUnitBySubagent(wu.units, subagentId);
  if (byAgent) unitId = byAgent.id;
}

if (unitId) {
  await markUnitEvidence(unitId, subagentId, root);
  const evidenceRel = `evidence/units/${unitId}.jsonl`;
  const unit = findUnitById(wu?.units ?? [], unitId);
  let acceptanceOk = true;
  if (unit) {
    const evidenceFull = path.join(goalDir(root), evidenceRel);
    await mkdir(path.dirname(evidenceFull), { recursive: true });
    if (!existsSync(evidenceFull)) {
      await appendFile(
        evidenceFull,
        JSON.stringify({
          at: new Date().toISOString(),
          evidence_version: 1,
          work_unit_id: unitId,
          pending: true,
        }) + "\n",
        "utf8",
      );
    }
    const acc = await runUnitAcceptance(unit, root);
    acceptanceOk = acc.ok;
    const statusOk = subagentStatusOk(status);
    const evidenceLine = {
      at: new Date().toISOString(),
      evidence_version: 1,
      subagent_id: subagentId,
      subagent_status: status,
      status,
      work_unit_id: unitId,
      acceptance: acc.commands,
      acceptance_ok: acc.ok,
      ...(statusOk ? {} : { blocked: true, blocker: subagentStatusBlockedReason(status) }),
    };
    await appendFile(
      path.join(goalDir(root), evidenceRel),
      JSON.stringify(evidenceLine) + "\n",
      "utf8",
    );
    if (acc.ok && statusOk) {
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
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({ agent_message: `subagentStop warning: ${msg}; continuing fail-open` });
}
