import { existsSync } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureGoalDirs, goalDir, goalMd, projectRoot, readJson } from "../lib/paths.js";
import { parseGoalMd } from "../lib/parse-goal-md.js";
import { syncLoopLimitToManifest } from "../lib/loop-limit.js";
import { buildDispatchQueue } from "../lib/dispatch-queue.js";
import { invalidateRuntimeState } from "../lib/dispatch-cli.js";
import { auditGoalAlignment } from "../lib/goal-alignment.js";
import { validateAll } from "./schemas.js";
import { defaultUnitAcceptance } from "../lib/unit-acceptance-defaults.js";

export type CompiledArtifacts = {
  manifest: Record<string, unknown>;
  scope: { paths: string[]; enforce: boolean };
  checks: { commands: string[] };
  intent: Record<string, unknown>;
  claim: Record<string, unknown>;
  workUnits: { units: WorkUnitCompiled[] };
  trajectory: { phase: string; sliceBudget?: number; updated_at: string };
  proofPlan: { checks: string[]; shell_allowlist: string[]; shell_patterns: string[] };
  dispatchQueue: { items: Array<{ order: number; unit_id: string; title: string; scope: string[]; acceptance: string[] }>; head_index: number };
};

export type WorkUnitCompiled = {
  id: string;
  title: string;
  scope: string[];
  acceptance: string[];
  status: "pending" | "in_progress" | "evidence_received" | "done";
  subagent_id: string | null;
  evidence_path: string;
  verified_by?: string | null;
  verify_prompt?: string | null;
};

async function atomicWriteJson(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

function shellAllowlistFromChecks(checks: string[]): string[] {
  const list = new Set<string>();
  for (const cmd of checks) {
    list.add(cmd.trim());
    const first = cmd.trim().split(/\s+/)[0];
    if (first) list.add(first);
  }
  list.add("true");
  list.add("git");
  list.add("cursor-goal");
  list.add("npm");
  list.add("node");
  list.add("npx");
  list.add("uv");
  list.add("pytest");
  return [...list];
}

function shellPatternsFromChecks(checks: string[]): string[] {
  const patterns = new Set([
    "^cursor-goal\\s",
    "^git\\s",
    "^true$",
    "^npm\\s",
    "^node\\s",
    "^npx\\s",
    "^uv\\s",
    "^pytest\\s",
  ]);
  for (const cmd of checks) {
    const esc = cmd.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (esc) patterns.add(`^${esc}`);
  }
  return [...patterns];
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameNullableString(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

function sameWorkUnitDefinition(a: WorkUnitCompiled, b: WorkUnitCompiled): boolean {
  return (
    a.title === b.title &&
    sameStringArray(a.scope, b.scope) &&
    sameStringArray(a.acceptance, b.acceptance) &&
    sameNullableString(a.verified_by, b.verified_by) &&
    sameNullableString(a.verify_prompt, b.verify_prompt)
  );
}

function assertUniqueWorkUnitIds(units: WorkUnitCompiled[]): void {
  const seen = new Map<string, string>();
  for (const unit of units) {
    const priorTitle = seen.get(unit.id);
    if (priorTitle !== undefined) {
      throw new Error(
        `duplicate work unit id "${unit.id}" from "${priorTitle}" and "${unit.title}"`,
      );
    }
    seen.set(unit.id, unit.title);
  }
}

async function mergeWorkUnits(
  compiled: WorkUnitCompiled[],
  existingPath: string,
): Promise<WorkUnitCompiled[]> {
  if (!existsSync(existingPath)) return compiled;
  const raw = await readJson<{ units?: WorkUnitCompiled[] }>(existingPath).catch(() => null);
  if (!raw?.units) return compiled;
  const byId = new Map(raw.units.map((u) => [u.id, u]));
  return compiled.map((u) => {
    const prev = byId.get(u.id);
    if (!prev) return u;
    if (!sameWorkUnitDefinition(u, prev)) return u;
    return {
      ...u,
      status: prev.status,
      subagent_id: prev.subagent_id,
    };
  });
}

async function compiledAtAfterGoalMtime(root: string): Promise<string> {
  let minMs = Date.now();
  try {
    const s = await stat(goalMd(root));
    minMs = Math.max(minMs, Math.ceil(s.mtimeMs) + 1);
  } catch {
    /* GOAL existence is checked before compile. */
  }
  return new Date(minMs).toISOString();
}

export async function buildCompiledArtifacts(root: string): Promise<CompiledArtifacts> {
  const parsed = await parseGoalMd(root);
  const loopLimit = await syncLoopLimitToManifest(root);
  const now = await compiledAtAfterGoalMtime(root);

  const scopePayload = {
    paths: parsed.scope,
    enforce: parsed.scope.length > 0,
  };

  const unitDrafts = parsed.workUnits.map((u) => ({
    id: u.id,
    title: u.title,
    scope: u.scope.length ? u.scope : parsed.scope.slice(0, 1),
    acceptance: defaultUnitAcceptance(
      { id: u.id, scope: u.scope.length ? u.scope : parsed.scope.slice(0, 1) },
      u.acceptance,
    ),
    status: "pending" as const,
    subagent_id: null,
    evidence_path: `evidence/units/${u.id}.jsonl`,
    verified_by: u.verified_by ?? null,
    verify_prompt: u.verify_prompt ?? null,
  }));
  assertUniqueWorkUnitIds(unitDrafts);

  const existingWu = path.join(goalDir(root), "work-units.json");
  const units = await mergeWorkUnits(unitDrafts, existingWu);

  const trajPath = path.join(goalDir(root), "trajectory.json");
  const existingTraj = await readJson<{ phase?: string }>(trajPath).catch(() => null);
  const phase = existingTraj?.phase ?? "DISCOVERY";

  return {
    manifest: {
      goal_id: "default",
      loop_limit: loopLimit,
      runtime: "package",
      compiled_at: now,
    },
    scope: scopePayload,
    checks: { commands: parsed.checks },
    intent: {
      goal: parsed.goalText,
      non_goals: parsed.nonGoals,
      checks: parsed.checks,
      forbidden_proxies: parsed.forbiddenProxies,
      compiled_at: now,
    },
    claim: {
      claim: parsed.goalText,
      scope: { paths: parsed.scope },
      checks: parsed.checks,
      forbiddenProxies: parsed.forbiddenProxies,
      workUnits: parsed.workUnits.map((u) => ({
        id: u.id,
        title: u.title,
        scope: u.scope,
        acceptance: u.acceptance,
        verified_by: u.verified_by ?? null,
        verify_prompt: u.verify_prompt ?? null,
      })),
    },
    workUnits: { units },
    trajectory: { phase, sliceBudget: 8, updated_at: now },
    proofPlan: {
      checks: parsed.checks,
      shell_allowlist: shellAllowlistFromChecks(parsed.checks),
      shell_patterns: shellPatternsFromChecks(parsed.checks),
    },
    dispatchQueue: buildDispatchQueue(units),
  };
}

export async function compileGoalV2(root?: string): Promise<void> {
  const r = projectRoot();
  const project = root ?? r;
  if (!existsSync(goalMd(project))) {
    throw new Error("GOAL.md not found");
  }
  await ensureGoalDirs(project);
  await mkdir(path.join(goalDir(project), "evidence", "units"), { recursive: true });

  const alignment = await auditGoalAlignment(project);
  for (const a of alignment) {
    if (a.level === "warn") console.warn(`cursor-goal compile: ${a.message}`);
  }
  const alignmentErrors = alignment.filter((a) => a.level === "error");
  if (alignmentErrors.length > 0) {
    throw new Error(
      `GOAL alignment failed:\n${alignmentErrors.map((a) => a.message).join("\n")}`,
    );
  }

  const artifacts = await buildCompiledArtifacts(project);

  const validation = await validateAll({
    manifest: artifacts.manifest,
    scope: artifacts.scope,
    checks: artifacts.checks,
    intent: artifacts.intent,
    claim: artifacts.claim,
    "work-units": artifacts.workUnits,
    trajectory: artifacts.trajectory,
    "proof-plan": artifacts.proofPlan,
    "dispatch-queue": artifacts.dispatchQueue,
  });

  if (validation.length > 0) {
    throw new Error(`Compile validation failed:\n${validation.join("\n")}`);
  }

  if (artifacts.scope.enforce && artifacts.workUnits.units.length === 0) {
    throw new Error("I14: non-empty scope requires at least one work unit");
  }

  const gd = goalDir(project);
  await atomicWriteJson(path.join(gd, "manifest.json"), artifacts.manifest);
  await atomicWriteJson(path.join(gd, "scope.json"), artifacts.scope);
  await atomicWriteJson(path.join(gd, "checks.json"), artifacts.checks);
  await atomicWriteJson(path.join(gd, "intent.json"), artifacts.intent);
  await atomicWriteJson(path.join(gd, "claim.json"), artifacts.claim);
  await atomicWriteJson(path.join(gd, "work-units.json"), artifacts.workUnits);
  await atomicWriteJson(path.join(gd, "proof-plan.json"), artifacts.proofPlan);
  await atomicWriteJson(path.join(gd, "dispatch-queue.json"), artifacts.dispatchQueue);

  const trajPath = path.join(gd, "trajectory.json");
  if (!existsSync(trajPath)) {
    await atomicWriteJson(trajPath, artifacts.trajectory);
  } else {
    const existingTraj = await readJson<{ phase?: string; discovery_completed_at?: string }>(
      trajPath,
    ).catch(() => null);
    await atomicWriteJson(trajPath, {
      ...existingTraj,
      phase: existingTraj?.phase ?? artifacts.trajectory.phase,
      sliceBudget: artifacts.trajectory.sliceBudget,
      discovery_completed_at: existingTraj?.discovery_completed_at,
      updated_at: artifacts.trajectory.updated_at,
    });
  }

  const discPath = path.join(gd, "discovery.json");
  if (!existsSync(discPath)) {
    await atomicWriteJson(discPath, { completed: false, notes: "" });
  }

  await invalidateRuntimeState(project);
}
