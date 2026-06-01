import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir, goalMd, projectRoot, readJson } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import { resolveAgentId, readAgentHandoffRead } from "../lib/runtime-state.js";
import { readRepoBlockedStopTotal } from "../lib/goal-loop.js";
import { readLoopLimit } from "../lib/loop-limit.js";
import { readAgentLoopCount } from "../lib/agent-runtime-state.js";
import { hasAgentDisposition } from "../lib/disposition.js";

const MAX_CONTEXT = 2000;

async function main(): Promise<void> {
  const root = projectRoot();
  const input = await readStdinJson<{ conversation_id?: string }>();

  if (!existsSync(goalMd(root))) {
    hookJson({});
    return;
  }

  const agentId = resolveAgentId(input);
  const lines: string[] = ["[cursor-goal compaction snapshot]"];

  try {
    const traj = await readJson<{ phase?: string }>(path.join(goalDir(root), "trajectory.json"));
    if (traj?.phase) lines.push(`phase: ${traj.phase}`);
  } catch {
    /* ignore */
  }

  try {
    const handoff = await readAgentHandoffRead(root, agentId);
    if (handoff.submitBlocked || handoff.handoff?.blocked) {
      if (handoff.handoff?.next_action) {
        lines.push(`next_action: ${String(handoff.handoff.next_action).slice(0, 400)}`);
      }
      if (handoff.handoff?.last_check_fail) {
        lines.push(`last_check_fail: ${String(handoff.handoff.last_check_fail).slice(0, 200)}`);
      }
      const loop = handoff.handoff?.loop_count ?? (await readAgentLoopCount(root, agentId));
      const limit = handoff.handoff?.loop_limit ?? (await readLoopLimit(root));
      const repoTotal = await readRepoBlockedStopTotal(root);
      lines.push(`goal_loop: ${loop}/${limit} (repo blocked stops: ${repoTotal})`);
    }
  } catch {
    /* ignore */
  }

  if (await hasAgentDisposition(root, agentId)) {
    lines.push(`disposition: .cursor/goal/agents/${agentId}/DISPOSITION.md`);
  }

  if (lines.length <= 1) {
    hookJson({});
    return;
  }

  const additional_context = lines.join("\n").slice(0, MAX_CONTEXT);
  hookJson({ additional_context });
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({ agent_message: `preCompact warning: ${msg}` });
}
