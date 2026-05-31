import { copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isGitRepo } from "../lib/git.js";
import {
  readGovernanceConfig,
  readSessionMode,
  shouldAutoInitOnSessionStart,
  type GovernanceConfig,
  type SessionModeFile,
} from "../lib/governance-config.js";
import { hasAgentDisposition, isAgentSubmitBlocked } from "../lib/disposition.js";
import { resolveAgentId } from "../lib/runtime-state.js";
import { readRepoBlockedStopTotal } from "../lib/goal-loop.js";
import { ensureGoalDirs, goalDir, goalMd, projectRoot } from "../lib/paths.js";
import { readPersistedLoopCount } from "../lib/loop-count.js";
import { readLoopLimit } from "../lib/loop-limit.js";
import { sessionBrief } from "../lib/stop-playbook.js";
import { goalTemplatePath } from "../lib/template.js";
import { auditGoalAlignment } from "../lib/goal-alignment.js";
import { isGoalStale } from "../lib/compile-stale.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import { readTrajectory } from "../trajectory/fsm.js";

async function tryCompileGoal(root: string): Promise<void> {
  try {
    const { compileGoalV2 } = await import("../compile/compile-v2.js");
    await compileGoalV2(root);
  } catch {
    /* compile may be unavailable or fail mid-edit; hooks still run */
  }
}

async function main(): Promise<void> {
  const sessionInput = await readStdinJson<{ conversation_id?: string }>();
  const agentId = resolveAgentId(sessionInput);
  const root = projectRoot();
  await ensureGoalDirs(root);

  let config: GovernanceConfig = { default_mode: "auto" };
  let session: SessionModeFile | null = null;
  let autoInitNote = "";
  let autoInitializedGoal = false;

  try {
    config = await readGovernanceConfig(root);
    session = await readSessionMode(root);
  } catch {
    autoInitNote = "cursor-goal: governance config unreadable; continuing fail-open";
  }

  if (
    !existsSync(goalMd(root)) &&
    isGitRepo(root) &&
    shouldAutoInitOnSessionStart(config, session)
  ) {
    try {
      await copyFile(goalTemplatePath(), goalMd(root));
      autoInitializedGoal = true;
      autoInitNote = "cursor-goal: initialized GOAL.md — edit checks and re-run compile";
      await tryCompileGoal(root);
    } catch {
      autoInitNote = "cursor-goal: failed to auto-init GOAL.md — run: cursor-goal init";
    }
  } else if (!existsSync(goalMd(root)) && config.default_mode === "auto" && !session) {
    autoInitNote = "cursor-goal: auto mode — run cursor-goal init when starting delivery work";
  }

  const wuPath = path.join(goalDir(root), "work-units.json");
  if (existsSync(goalMd(root)) && !autoInitializedGoal) {
    try {
      if ((await isGoalStale(root)) || !existsSync(wuPath)) {
        await tryCompileGoal(root);
      }
    } catch {
      /* stale checks may fail on malformed local state; hooks still run */
    }
  }

  const traj = await readTrajectory(root).catch(() => ({ phase: "DISCOVERY" as const }));
  const loop = await readPersistedLoopCount(root, agentId).catch(() => 0);
  const repoTotal = await readRepoBlockedStopTotal(root).catch(() => 0);
  const limit = await readLoopLimit(root).catch(() => 40);
  let brief = autoInitNote || (await sessionBrief(root, traj.phase).catch(() => "cursor-goal: active"));
  if (!autoInitNote) {
    brief += `, loop=${loop}/${limit}`;
    if (repoTotal !== loop) {
      brief += ` (repo ${repoTotal}/${limit})`;
    }
  }

  if (existsSync(goalMd(root))) {
    try {
      const alignment = await auditGoalAlignment(root);
      const err = alignment.find((a) => a.level === "error");
      if (err) brief += `; GOAL alignment: ${err.message}`;
      else {
        const warn = alignment.find((a) => a.level === "warn");
        if (warn) brief += `; GOAL: ${warn.message}`;
      }
    } catch {
      /* ignore */
    }
  }

  try {
    if (await isAgentSubmitBlocked(root, agentId)) {
      const inDisposition = await hasAgentDisposition(root, agentId);
      brief += inDisposition
        ? `; disposition — see .cursor/goal/agents/${agentId}/DISPOSITION.md`
        : "; blocked — cursor-goal next";
    }
  } catch {
    brief += "; runtime state unreadable - continuing fail-open";
  }

  if (
    agentId === "default" &&
    !sessionInput.conversation_id?.trim() &&
    !process.env.CURSOR_CONVERSATION_ID?.trim()
  ) {
    brief += "; note: no conversation_id — shared default agent bucket";
  }

  hookJson({ agent_message: brief });
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({ agent_message: `cursor-goal sessionStart warning: ${msg}; continuing fail-open` });
}
