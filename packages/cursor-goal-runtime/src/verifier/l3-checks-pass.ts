import { runChecks } from "../lib/run-checks.js";
import type { LevelResult, VerifierContext } from "./types.js";

export async function levelChecksPass(ctx: VerifierContext): Promise<LevelResult> {
  ctx.checkResults = await runChecks(ctx.root, ctx.parsed.checks);
  for (const r of ctx.checkResults) {
    if (!r.ok) ctx.failures.push(r.cmd);
  }
  return {};
}
