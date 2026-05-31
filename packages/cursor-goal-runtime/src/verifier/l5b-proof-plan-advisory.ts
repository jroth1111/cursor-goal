import { readFile } from "node:fs/promises";
import path from "node:path";
import type { VerifierContext } from "./types.js";

export async function levelProofPlanAdvisory(ctx: VerifierContext): Promise<string[]> {
  const warnings: string[] = [];
  const planPath = path.join(ctx.root, ".cursor/goal/proof-plan.json");
  let plan: { shell_allowlist?: string[]; shell_patterns?: string[]; checks?: string[] };
  try {
    plan = JSON.parse(await readFile(planPath, "utf8")) as typeof plan;
  } catch {
    return warnings;
  }
  const allowlist = new Set(plan.shell_allowlist ?? []);
  const patterns = (plan.shell_patterns ?? []).map((p) => new RegExp(p));
  for (const result of ctx.checkResults) {
    const cmd = result.cmd.trim();
    if (!cmd) continue;
    if (allowlist.has(cmd)) continue;
    if (patterns.some((re) => re.test(cmd))) continue;
    if ((plan.checks ?? []).includes(cmd)) continue;
    warnings.push(`proof-plan: check command not in allowlist: ${cmd}`);
  }
  return warnings;
}
