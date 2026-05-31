import path from "node:path";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import { goalDir, projectRoot, readJson } from "./paths.js";
import { runChecks, type CheckResult } from "./run-checks.js";

export { defaultUnitAcceptance } from "./unit-acceptance-defaults.js";

export type UnitAcceptanceResult = {
  commands: string[];
  results: CheckResult[];
  ok: boolean;
};

export async function runUnitAcceptance(
  unit: WorkUnitCompiled,
  root?: string,
): Promise<UnitAcceptanceResult> {
  let commands = unit.acceptance.filter(Boolean);
  if (commands.length === 0) {
    const checks = await readJson<{ commands?: string[] }>(
      path.join(goalDir(root), "checks.json"),
    );
    commands = checks?.commands ?? ["true"];
  }
  const r = root ?? projectRoot();
  const results = await runChecks(r, commands);
  return {
    commands,
    results,
    ok: results.every((r) => r.ok),
  };
}
