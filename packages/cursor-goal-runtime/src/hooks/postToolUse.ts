import { existsSync } from "node:fs";
import { appendFile, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureGoalDirs, goalDir, projectRoot } from "../lib/paths.js";
import { markEdit, gitTreeId } from "../lib/git-state.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import { structuredWorkUnitId } from "../lib/work-units.js";
import { resolveAgentId, readAgentHandoffRead } from "../lib/runtime-state.js";
import { countRecentEdits, recordEditPath } from "../lib/edit-ledger.js";
import { readTrajectory } from "../trajectory/fsm.js";
import { readLoopLimit } from "../lib/loop-limit.js";
import { readAgentLoopCount } from "../lib/agent-runtime-state.js";

async function main(): Promise<void> {
  const input = await readStdinJson<{
    tool_name?: string;
    tool_output?: string;
    tool_input?: Record<string, unknown>;
    conversation_id?: string;
    exit_code?: number;
    work_unit_id?: string;
  }>();

  const root = projectRoot();
  await ensureGoalDirs(root);

  const tool = input.tool_name ?? "";
  const workUnitId = structuredWorkUnitId(input as Record<string, unknown>);

  const isEdit = tool === "Write" || tool === "Edit" || tool === "MultiEdit";

  if (isEdit) {
    await markEdit(root);
    await recordEditPath(root, input, workUnitId);
  }

  // Only shell out to git for edit-class tools — Read/Grep/Glob don't need tree state.
  const gitHead = isEdit ? gitTreeId(root) : null;
  const line = JSON.stringify({
    at: new Date().toISOString(),
    tool,
    git_head: gitHead,
    exit_code: input.exit_code ?? 0,
    work_unit_id: workUnitId,
    conversation_id: input.conversation_id,
    excerpt: (input.tool_output ?? "").slice(0, 500),
  });

  await appendFile(path.join(goalDir(root), "evidence", "ledger.jsonl"), line + "\n", "utf8");

  if (workUnitId) {
    const unitsDir = path.join(goalDir(root), "evidence", "units");
    await mkdir(unitsDir, { recursive: true });
    await appendFile(path.join(unitsDir, `${workUnitId}.jsonl`), line + "\n", "utf8");
  }

  const agentId = resolveAgentId(input);
  const handoffFlag = path.join(goalDir(root), ".post-tool-handoff-nudge");
  try {
    const handoff = await readAgentHandoffRead(root, agentId);
    const blocked = handoff.submitBlocked || handoff.handoff?.blocked === true;
    if (blocked && handoff.handoff?.next_action) {
      const shouldNudge = !existsSync(handoffFlag);
      if (shouldNudge) {
        await writeFile(handoffFlag, new Date().toISOString(), "utf8");
        const next = handoff.handoff.next_action;
        const summary = [next.headline, next.detail].filter(Boolean).join(" — ");
        hookJson({
          additional_context: `cursor-goal blocked: ${summary.slice(0, 500)}`,
        });
        return;
      }
    } else if (existsSync(handoffFlag)) {
      await unlink(handoffFlag).catch(() => undefined);
    }
  } catch {
    /* fail-open */
  }

  // Governance telemetry: emit phase/loop/edit context for edit-class tools.
  // Only fires when the handoff nudge above didn't already emit additional_context.
  if (isEdit) {
    try {
      const edits = await countRecentEdits(root);
      const traj = await readTrajectory(root);
      const loop = await readAgentLoopCount(root, agentId);
      const limit = await readLoopLimit(root);
      hookJson({
        additional_context: `cursor-goal: phase=${traj.phase} loop=${loop}/${limit} edits_this_session=${edits}`,
      });
      return;
    } catch {
      /* fail-open */
    }
  }

  hookJson({});
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({ agent_message: `postToolUse warning: ${msg}; continuing fail-open` });
}
