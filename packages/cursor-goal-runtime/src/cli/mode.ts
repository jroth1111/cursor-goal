import { compileGoalV2 } from "../compile/compile-v2.js";
import { projectRoot } from "../lib/paths.js";
import {
  clearSessionMode,
  readGovernanceConfig,
  readSessionMode,
  writeGovernanceConfig,
  writeSessionMode,
  type GovernanceMode,
} from "../lib/governance-config.js";
import { formatModeStatus, readLastTriageEntry } from "../lib/prompt-triage.js";
import { operatorOptionsFromArgv } from "./shared.js";
import { seedGoal } from "./goal.js";

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
    await clearSessionMode(root);
    console.log("Session mode cleared; using config default_mode");
    return;
  }
  if (sub === "chat" || sub === "governed") {
    await writeSessionMode(root, sub, "cli");
    if (sub === "governed") {
      await seedGoal();
      await compileGoalV2(root);
      console.log("Session mode: governed (GOAL initialized if missing)");
    } else {
      console.log("Session mode: chat");
    }
    return;
  }
  if (sub === "set" && rest[1]) {
    const mode = rest[1] as GovernanceMode;
    if (mode !== "auto" && mode !== "chat" && mode !== "governed") {
      console.error("Usage: cursor-goal mode set auto|chat|governed");
      process.exit(1);
    }
    await writeGovernanceConfig(root, { default_mode: mode });
    console.log(`default_mode=${mode}`);
    return;
  }
  if (sub === "why") {
    const entry = await readLastTriageEntry(root, operatorOptionsFromArgv(rest)?.conversation_id);
    if (!entry) {
      console.log("No triage log entry for this conversation");
      process.exit(1);
    }
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  console.error("Usage: cursor-goal mode [chat|governed|auto|set auto|chat|governed]");
  process.exit(1);
}
