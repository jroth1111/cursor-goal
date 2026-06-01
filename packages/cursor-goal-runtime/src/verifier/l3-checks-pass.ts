import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir, readJson } from "../lib/paths.js";
import { runChecks, resolveStopCheckProfile } from "../lib/run-checks.js";
import type { LevelResult, VerifierContext } from "./types.js";

async function loadCheckTiers(root: string): Promise<Record<string, "fast" | "full">> {
  const file = path.join(goalDir(root), "checks.json");
  if (!existsSync(file)) return {};
  const checks = await readJson<{ tiers?: Record<string, "fast" | "full"> }>(file);
  return checks?.tiers ?? {};
}

export async function levelChecksPass(ctx: VerifierContext): Promise<LevelResult> {
  const profile = ctx.checkProfile ?? resolveStopCheckProfile(ctx.loopCount);
  ctx.checkProfile = profile;
  ctx.checkTiers = await loadCheckTiers(ctx.root);
  ctx.checkResults = await runChecks(ctx.root, ctx.parsed.checks, {
    profile,
    tiers: ctx.checkTiers,
    useCache: profile === "fast",
  });
  for (const r of ctx.checkResults) {
    if (!r.ok) ctx.failures.push(r.cmd);
  }
  return {};
}

/** Run full-tier checks before RELEASE when stop used fast profile. */
export async function runFullTierChecksBeforeRelease(ctx: VerifierContext): Promise<void> {
  if (ctx.checkProfile !== "fast") return;
  const fullResults = await runChecks(ctx.root, ctx.parsed.checks, {
    profile: "all",
    tiers: ctx.checkTiers,
    useCache: false,
  });
  const byCmd = new Map(ctx.checkResults.map((r) => [r.cmd, r]));
  for (const r of fullResults) {
    byCmd.set(r.cmd, r);
    if (!r.ok && !ctx.failures.includes(r.cmd)) ctx.failures.push(r.cmd);
    if (r.ok) {
      const idx = ctx.failures.indexOf(r.cmd);
      if (idx >= 0) ctx.failures.splice(idx, 1);
    }
  }
  ctx.checkResults = [...byCmd.values()];
  ctx.checkProfile = "all";
}
