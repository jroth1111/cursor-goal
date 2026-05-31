import { existsSync } from "node:fs";
import { compileGoalV2 } from "../compile/compile-v2.js";
import { goalMd, projectRoot } from "../lib/paths.js";
import {
  clearSessionMode,
  readGovernanceConfig,
  readSessionMode,
  writeGovernanceConfig,
  writeSessionMode,
  type GovernanceMode,
} from "../lib/governance-config.js";
import { formatModeStatus, readLastTriageEntry } from "../lib/prompt-triage.js";
import { seedGoal } from "./goal.js";

const modeUsage = "Usage: cursor-goal mode [chat|governed|auto|set auto|chat|governed|why]";

function rejectModeUsage(): never {
  console.error(modeUsage);
  process.exit(1);
}

function modeWhyConversationId(rest: string[]): string | undefined {
  if (rest.length === 1) return undefined;
  if (rest.length === 3 && rest[1] === "--conversation" && rest[2] && !rest[2].startsWith("-")) {
    return rest[2];
  }
  rejectModeUsage();
}

export async function handleMode(rest: string[]): Promise<void> {
  const root = projectRoot();
  const sub = rest[0];
  if (!sub) {
    const config = await readGovernanceConfig(root);
    const session = await readSessionMode(root);
    console.log(formatModeStatus(config, session));
    return;
  }
  if (sub === "auto") {
    if (rest.length !== 1) rejectModeUsage();
    await clearSessionMode(root);
    console.log("Session mode cleared; using config default_mode");
    return;
  }
  if (sub === "chat" || sub === "governed") {
    if (rest.length !== 1) rejectModeUsage();
    await writeSessionMode(root, sub, "cli");
    if (sub === "governed") {
      const hadGoal = existsSync(goalMd(root));
      await seedGoal();
      if (hadGoal) {
        await compileGoalV2(root);
        console.log("Session mode: governed (GOAL compiled)");
      } else {
        console.log("Session mode: governed (GOAL initialized; edit GOAL.md, then run cursor-goal compile)");
      }
    } else {
      console.log("Session mode: chat");
    }
    return;
  }
  if (sub === "set" && rest[1]) {
    if (rest.length !== 2) rejectModeUsage();
    const mode = rest[1] as GovernanceMode;
    if (mode !== "auto" && mode !== "chat" && mode !== "governed") {
      rejectModeUsage();
    }
    await writeGovernanceConfig(root, { default_mode: mode });
    console.log(`default_mode=${mode}`);
    return;
  }
  if (sub === "why") {
    const entry = await readLastTriageEntry(root, modeWhyConversationId(rest));
    if (!entry) {
      console.log("No triage log entry for this conversation");
      process.exit(1);
    }
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  rejectModeUsage();
}
