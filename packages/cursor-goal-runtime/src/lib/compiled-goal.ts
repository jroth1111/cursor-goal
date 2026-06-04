import { existsSync } from "node:fs";
import path from "node:path";
import { isGoalStale } from "./compile-stale.js";
import { goalDir, readJson } from "./paths.js";
import type { CheckTier, ParsedGoal, WorkUnitDraft, WorkUnitRole } from "./parse-goal-md.js";

export type CompiledGoalLoadResult =
  | { ok: true; parsed: ParsedGoal }
  | { ok: false; message: string };

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function checkTiers(value: unknown): Record<string, CheckTier> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, CheckTier> = {};
  for (const [cmd, tier] of Object.entries(value)) {
    if (tier === "fast" || tier === "full") out[cmd] = tier;
  }
  return out;
}

function workUnitRole(value: unknown): WorkUnitRole {
  return value === "verify" ? "verify" : "implement";
}

function workUnits(value: unknown): WorkUnitDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const unit = raw as Record<string, unknown>;
    if (typeof unit.id !== "string" || typeof unit.title !== "string") return [];
    return [{
      id: unit.id,
      title: unit.title,
      scope: stringArray(unit.scope),
      acceptance: stringArray(unit.acceptance),
      role: workUnitRole(unit.role),
      verified_by: typeof unit.verified_by === "string" ? unit.verified_by : null,
      verify_prompt: typeof unit.verify_prompt === "string" ? unit.verify_prompt : null,
    }];
  });
}

export async function loadCompiledGoal(root: string): Promise<CompiledGoalLoadResult> {
  const gd = goalDir(root);
  const required = ["manifest.json", "checks.json", "intent.json", "scope.json", "work-units.json"];
  const missing = required.filter((name) => !existsSync(path.join(gd, name)));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Compiled GOAL artifacts missing (${missing.join(", ")}). Run: cursor-goal compile`,
    };
  }

  if (await isGoalStale(root)) {
    return {
      ok: false,
      message: "GOAL.md changed after compile. Run: cursor-goal compile",
    };
  }

  try {
    const checks = await readJson<{ commands?: unknown; tiers?: unknown }>(path.join(gd, "checks.json"));
    const intent = await readJson<{
      goal?: unknown;
      non_goals?: unknown;
      forbidden_proxies?: unknown;
    }>(path.join(gd, "intent.json"));
    const scope = await readJson<{ paths?: unknown }>(path.join(gd, "scope.json"));
    const units = await readJson<{ units?: unknown }>(path.join(gd, "work-units.json"));
    const commands = stringArray(checks?.commands);

    return {
      ok: true,
      parsed: {
        goalText: typeof intent?.goal === "string" ? intent.goal : "Complete work per GOAL.md",
        nonGoals: stringArray(intent?.non_goals),
        checks: commands,
        checkTiers: checkTiers(checks?.tiers),
        scope: stringArray(scope?.paths),
        forbiddenProxies: stringArray(intent?.forbidden_proxies),
        workUnits: workUnits(units?.units),
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      message: `Compiled GOAL artifacts unreadable (${msg}). Run: cursor-goal compile`,
    };
  }
}
