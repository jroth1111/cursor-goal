import { readGovernanceConfig, readSessionMode } from "./governance-config.js";
import { isAnyAgentBlocked } from "./runtime-state.js";
import {
  hasGovernedContract,
  isBlockedRuntime,
  readLastTriageEntry,
} from "./prompt-triage.js";

async function blockedForGovernance(root: string, agentId?: string): Promise<boolean> {
  if (agentId) return isBlockedRuntime(root, agentId);
  return isAnyAgentBlocked(root);
}

async function triageForcedGovernance(root: string, agentId?: string): Promise<boolean> {
  const entry = await readLastTriageEntry(root, agentId);
  if (!entry?.classification?.forceGoverned) return false;
  return hasGovernedContract(root);
}

/** True when stop verifier / RELEASE pipeline should run. */
export async function isGovernanceActive(root: string, agentId?: string): Promise<boolean> {
  const session = await readSessionMode(root);
  if (session?.mode === "governed") return true;

  if (await blockedForGovernance(root, agentId)) return true;

  if (session?.mode === "chat") {
    if (await triageForcedGovernance(root, agentId)) return true;
    return false;
  }

  const config = await readGovernanceConfig(root);
  if (config.default_mode === "governed") return true;
  if (config.default_mode === "chat") {
    if (await triageForcedGovernance(root, agentId)) return true;
    return false;
  }

  if (await hasGovernedContract(root)) return true;
  if (await triageForcedGovernance(root, agentId)) return true;

  return false;
}

/** True when preToolUse may passthrough (skip phase/scope gates). Narrower than prompt chat. */
export async function isToolGovernancePassthrough(
  root: string,
  _agentId?: string,
): Promise<boolean> {
  const session = await readSessionMode(root);
  if (session?.mode === "chat") return true;
  const config = await readGovernanceConfig(root);
  if (config.default_mode === "chat") return true;
  return false;
}
