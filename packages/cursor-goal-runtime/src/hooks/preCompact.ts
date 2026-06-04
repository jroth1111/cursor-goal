import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir, goalMd, passportsDir, projectRoot, readJson } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import { resolveAgentId, readAgentHandoffRead } from "../lib/runtime-state.js";
import { readRepoBlockedStopTotal } from "../lib/goal-loop.js";
import { readLoopLimit } from "../lib/loop-limit.js";
import { readAgentLoopCount } from "../lib/agent-runtime-state.js";
import { hasAgentDisposition } from "../lib/disposition.js";
import { listRecentEditedFiles } from "../lib/edit-ledger.js";
import { readWorkUnits } from "../lib/work-units.js";
import { readStopSignatureTail } from "../lib/stop-signature.js";

const MAX_CONTEXT = 2000;

type ChecksSnapshot = {
  commands?: unknown;
  tiers?: unknown;
};

function checkSummary(checks: ChecksSnapshot | null): string | null {
  const commands = Array.isArray(checks?.commands)
    ? checks.commands.filter((cmd): cmd is string => typeof cmd === "string")
    : [];
  if (commands.length === 0) return null;
  const tiers = checks?.tiers && typeof checks.tiers === "object" && !Array.isArray(checks.tiers)
    ? (checks.tiers as Record<string, unknown>)
    : {};
  const display = commands.slice(0, 4).map((cmd) => {
    const tier = tiers[cmd] === "fast" || tiers[cmd] === "full" ? `[${tiers[cmd]}] ` : "";
    return `${tier}${cmd}`;
  });
  const remaining = commands.length - display.length;
  return `${display.join("; ")}${remaining > 0 ? `; +${remaining} more` : ""}`;
}

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
    const checks = checkSummary(
      await readJson<ChecksSnapshot>(path.join(goalDir(root), "checks.json")),
    );
    if (checks) lines.push(`checks: ${checks}`);
    lines.push(
      `release: ${
        existsSync(path.join(passportsDir(root), "RELEASE.json")) ? "present" : "missing"
      }`,
    );
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

  // Enriched: recent edits, subagent summary, last stop signatures.
  try {
    const edited = await listRecentEditedFiles(root);
    if (edited.length > 0) {
      const display = edited.slice(-10);
      const remaining = edited.length - display.length;
      lines.push(`recent_edits (${edited.length}): ${display.join(", ")}${remaining > 0 ? ` +${remaining} more` : ""}`);
    }
  } catch {
    /* ignore */
  }

  try {
    const wu = await readWorkUnits(root);
    if (wu) {
      const active = wu.units.filter((u) => u.status === "in_progress" || u.status === "pending");
      if (active.length > 0) {
        lines.push(`open_units: ${active.map((u) => `${u.id}(${u.status})`).join(", ")}`);
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const sigs = await readStopSignatureTail(root, agentId, 3);
    if (sigs.length > 0) {
      lines.push(`last_signatures: ${sigs.map((s) => s.signature.slice(0, 60)).join(" | ")}`);
    }
  } catch {
    /* ignore */
  }

  if (lines.length <= 1) {
    hookJson({});
    return;
  }

  const user_message = lines.join("\n").slice(0, MAX_CONTEXT);
  hookJson({ user_message });
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({ user_message: `preCompact warning: ${msg}` });
}
