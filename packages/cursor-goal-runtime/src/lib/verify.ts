import { existsSync } from "node:fs";
import { goalMd, projectRoot } from "./paths.js";
import { parseGoalMd } from "./parse-goal-md.js";
import { isGovernanceActive } from "./governance-active.js";
import { resolveAgentId } from "./runtime-state.js";
import { readGovernanceConfig, readSessionMode } from "./governance-config.js";
import { runStopPipeline, type StopInput, type VerifyResult } from "../verifier/index.js";

export type { StopInput, VerifyResult };

export async function runStopVerifier(input: StopInput): Promise<VerifyResult> {
  const root = projectRoot();
  const governed = await isGovernanceActive(root, resolveAgentId(input));
  if (!governed) {
    const session = await readSessionMode(root);
    const config = await readGovernanceConfig(root);
    if (session?.mode === "chat" || config.default_mode === "chat") {
      return { kind: "idle" };
    }
    if (!existsSync(goalMd(root))) {
      return { kind: "idle" };
    }
  }

  return runStopPipeline(input);
}

export function hookJson(body: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(body)}\n`);
}
