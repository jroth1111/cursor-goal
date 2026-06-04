import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { atomicWriteJson, goalDir, readJson } from "./paths.js";
import { resolveAgentId } from "./runtime-state.js";
import { readWorkUnits } from "./work-units.js";
import { formatGovernedSubmitHeader } from "./governed-submit-header.js";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import type { WorkUnitRole } from "./parse-goal-md.js";

export type PromptContextMode = "chat" | "nudge" | "governed";
export type PromptInteractionModeHint = "chat" | "delivery";

export type PromptUnitRoleMismatch = {
  unit_id: string;
  expected_role: WorkUnitRole;
  requested_role: WorkUnitRole;
};

export type PromptContext = {
  at: string;
  agent_id: string;
  mode: PromptContextMode;
  effective_mode: PromptContextMode;
  interaction_mode_hint?: PromptInteractionModeHint;
  prompt_hash: string;
  mentioned_paths: string[];
  mentioned_rules: string[];
  mentioned_commands: string[];
  mentioned_units: string[];
  unknown_units: string[];
  unit_role_mismatches: PromptUnitRoleMismatch[];
  out_of_scope_paths: string[];
  warnings: string[];
  /** Backward-compatible aliases for callers added before structured names. */
  paths: string[];
  commands: string[];
  unit_ids: string[];
};

export type WritePromptContextOptions = {
  mode: PromptContextMode;
  effectiveMode?: PromptContextMode;
  interactionModeHint?: PromptInteractionModeHint;
  conversationId?: string;
};

function normalizeSlash(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, "/").replace(/^\.\//, ""));
}

function trimToken(value: string): string {
  return normalizeSlash(value).replace(/[),.;:!?'"`]+$/g, "");
}

function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function stripGeneratedDiagnosticSegments(line: string): string {
  return line
    .replace(
      /\bSESSION_END present\s*[-—]\s*resume:\s*cursor-goal explain session-end && cursor-goal session-end clear --force && cursor-goal next\b/gi,
      " ",
    )
    .replace(
      /\bprior session ended without RELEASE\s*[-—]\s*run:\s*cursor-goal explain(?: session-end)?(?: && cursor-goal next)?\b/gi,
      " ",
    )
    .replace(
      /\bPrompt intent conflicts with active GOAL:.*?\bCorrection:\s*cursor-goal next(?:\s+--conversation\s+\S+)?\s+Fallback:\s*keep work inside active scope and target a valid open unit\.?/gis,
      " ",
    );
}

function stripGeneratedCursorGoalDiagnostics(prompt: string): string {
  return stripGeneratedDiagnosticSegments(prompt.replace(/\r\n/g, "\n")).trim();
}

function stripGeneratedContextSeparator(text: string): string {
  return text.replace(/^[\s;,\-—]+/u, "").trim();
}

async function promptTextForContext(root: string, prompt: string): Promise<string> {
  let text = stripGeneratedCursorGoalDiagnostics(prompt);
  const header = await formatGovernedSubmitHeader(root).catch(() => null);
  if (!header) return text;

  const normalizedHeader = header.replace(/\r\n/g, "\n").trimEnd();
  if (text.startsWith(normalizedHeader)) {
    text = stripGeneratedContextSeparator(text.slice(normalizedHeader.length));
  }
  return text;
}

const STRONG_PATH_PREFIXES = new Set([
  "app",
  "apps",
  "assets",
  "client",
  "components",
  "config",
  "configs",
  "core",
  "db",
  "decompile",
  "docs",
  "lib",
  "libs",
  "migrations",
  "packages",
  "pages",
  "public",
  "routes",
  "scripts",
  "server",
  "spec",
  "specs",
  "src",
  "styles",
  "test",
  "tests",
  "tools",
]);

function hasFileExtension(segments: string[]): boolean {
  return segments.some((segment) => /\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(segment));
}

function shouldKeepPathToken(token: string, explicitAt: boolean): boolean {
  const clean = token.startsWith("@") ? token.slice(1) : token;
  if (!clean || clean === "/" || clean.startsWith(".cursor/goal/")) return false;
  const parts = clean.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return false;
  if (parts.every((part) => /^\d+$/.test(part))) return false;
  if (explicitAt) return true;

  const first = parts[0]?.toLowerCase() ?? "";
  if (clean.startsWith(".")) return true;
  if (STRONG_PATH_PREFIXES.has(first)) return true;
  if (hasFileExtension(parts)) return true;
  return false;
}

export function extractPromptPathRefs(prompt: string): string[] {
  const out = new Set<string>();
  const promptText = stripGeneratedCursorGoalDiagnostics(prompt);
  const pathLike =
    /(?:^|[\s"'`(])(@?(?!https?:\/\/)(?:[A-Za-z0-9_.-]+\/){1,}[A-Za-z0-9_.-]+\/?)/g;
  for (const match of promptText.matchAll(pathLike)) {
    const token = trimToken(match[1] ?? "");
    const withoutAt = token.startsWith("@") ? token.slice(1) : token;
    if (!shouldKeepPathToken(token, token.startsWith("@"))) continue;
    out.add(withoutAt);
  }
  const atPath = /@((?:[A-Za-z0-9_.-]+\/){1,}[A-Za-z0-9_.-]+\/?)/g;
  for (const match of promptText.matchAll(atPath)) {
    const token = trimToken(match[1] ?? "");
    if (!shouldKeepPathToken(token, true)) continue;
    out.add(token);
  }
  return [...out];
}

export function extractPromptCommands(prompt: string): string[] {
  const out = new Set<string>();
  const promptText = stripGeneratedCursorGoalDiagnostics(prompt);
  const re = /`([^`\n]+)`/g;
  for (const m of promptText.matchAll(re)) {
    const token = (m[1] ?? "").trim();
    if (!token) continue;
    if (/\s/.test(token) || token.includes("/")) out.add(token);
  }
  return [...out];
}

const GOVERNANCE_RULE_REFS = [
  "AGENTS.md",
  "INVARIANTS.json",
  "CAPABILITY.md",
  "GOAL.md",
  "RUNBOOK.md",
  "README.md",
  "docs/CONTRIBUTING.md",
  "docs/BRANCH_REVIEW.md",
  "docs/ARCHITECTURE.md",
  ".cursor/goal/config.json",
  ".cursor/hooks.json",
];

export function extractPromptRuleRefs(prompt: string): string[] {
  const out = new Set<string>();
  const promptText = stripGeneratedCursorGoalDiagnostics(prompt);
  for (const ref of GOVERNANCE_RULE_REFS) {
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}($|[^A-Za-z0-9_./-])`, "i").test(promptText)) {
      out.add(ref);
    }
  }
  for (const pathRef of extractPromptPathRefs(promptText)) {
    if (
      pathRef === "AGENTS.md" ||
      pathRef.endsWith("/AGENTS.md") ||
      pathRef.endsWith(".md") ||
      pathRef.endsWith(".json")
    ) {
      out.add(pathRef);
    }
  }
  return [...out];
}

function validUnitId(value: string): string | null {
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9_-]*$/i.test(trimmed) ? trimmed : null;
}

export function extractPromptUnitRefs(prompt: string): string[] {
  const out = new Set<string>();
  const promptText = stripGeneratedCursorGoalDiagnostics(prompt);
  const patterns = [
    /\bwork[_ -]?unit[_ -]?id\s*[:=]\s*["']?([a-z0-9][a-z0-9_-]*)/gi,
    /\[work-unit:([a-z0-9][a-z0-9_-]*)\]/gi,
    /@unit:([a-z0-9][a-z0-9_-]*)/gi,
    /\bwork\s+unit\s+([a-z0-9][a-z0-9_-]*)\b/gi,
  ];
  for (const re of patterns) {
    for (const match of promptText.matchAll(re)) {
      const id = validUnitId(match[1] ?? "");
      if (id) out.add(id);
    }
  }
  return [...out];
}

function pathInScope(filePath: string, scopePaths: string[]): boolean {
  const norm = normalizeSlash(filePath);
  if (norm === "GOAL.md" || norm.startsWith(".cursor/goal/")) return true;
  return scopePaths.some((p) => {
    if (p === "**") return true;
    const base = normalizeSlash(p).replace(/\/+$/, "");
    if (base === "." || base === "") return true;
    return norm === base || norm.startsWith(`${base}/`);
  });
}

function requestedRole(prompt: string): WorkUnitRole | null {
  if (/\b(verify|review|validate|acceptance|adversarial)\b/i.test(prompt)) return "verify";
  if (/\b(implement|edit|fix|build|dispatch|touch|update|write)\b/i.test(prompt)) return "implement";
  return null;
}

function splitUnitRefs(
  unitRefs: string[],
  units: WorkUnitCompiled[],
): { known: string[]; unknown: string[] } {
  const knownIds = new Set(units.map((u) => u.id.toLowerCase()));
  const known: string[] = [];
  const unknown: string[] = [];
  for (const ref of unitRefs) {
    if (knownIds.has(ref.toLowerCase())) known.push(ref);
    else unknown.push(ref);
  }
  return { known, unknown };
}

function unitRoleMismatches(
  prompt: string,
  mentionedUnits: string[],
  units: WorkUnitCompiled[],
): PromptUnitRoleMismatch[] {
  const requested = requestedRole(prompt);
  if (!requested) return [];
  const byId = new Map(units.map((u) => [u.id.toLowerCase(), u]));
  const out: PromptUnitRoleMismatch[] = [];
  for (const id of mentionedUnits) {
    const unit = byId.get(id.toLowerCase());
    if (!unit || unit.role === requested) continue;
    out.push({
      unit_id: unit.id,
      expected_role: unit.role,
      requested_role: requested,
    });
  }
  return out;
}

function promptContextPath(root: string, agentId: string): string {
  return path.join(goalDir(root), "agents", agentId, "prompt-context.json");
}

export async function buildPromptContext(
  root: string,
  prompt: string,
  options: WritePromptContextOptions,
): Promise<PromptContext> {
  const agentId = resolveAgentId(options.conversationId);
  const scope = await readJson<{ paths?: string[]; enforce?: boolean }>(
    path.join(goalDir(root), "scope.json"),
  ).catch(() => null);
  const workUnits = (await readWorkUnits(root).catch(() => null))?.units ?? [];
  const contextPrompt = await promptTextForContext(root, prompt);
  const mentioned_paths = extractPromptPathRefs(contextPrompt);
  const mentioned_rules = extractPromptRuleRefs(contextPrompt);
  const mentioned_commands = extractPromptCommands(contextPrompt);
  const unitRefs = extractPromptUnitRefs(contextPrompt);
  const split = splitUnitRefs(unitRefs, workUnits);
  const scopePaths = scope?.paths ?? [];
  const out_of_scope_paths =
    scope?.enforce && scopePaths.length > 0
      ? mentioned_paths.filter((p) => !pathInScope(p, scopePaths))
      : [];
  const unit_role_mismatches = unitRoleMismatches(contextPrompt, split.known, workUnits);
  const warnings = [
    ...out_of_scope_paths.map((p) => `out_of_scope_path:${p}`),
    ...split.unknown.map((u) => `unknown_unit:${u}`),
    ...unit_role_mismatches.map(
      (m) => `unit_role_mismatch:${m.unit_id}:${m.requested_role}->${m.expected_role}`,
    ),
  ];

  return {
    at: new Date().toISOString(),
    agent_id: agentId,
    mode: options.mode,
    effective_mode: options.effectiveMode ?? options.mode,
    ...(options.interactionModeHint ? { interaction_mode_hint: options.interactionModeHint } : {}),
    prompt_hash: promptHash(prompt),
    mentioned_paths,
    mentioned_rules,
    mentioned_commands,
    mentioned_units: split.known,
    unknown_units: split.unknown,
    unit_role_mismatches,
    out_of_scope_paths,
    warnings,
    paths: mentioned_paths,
    commands: mentioned_commands,
    unit_ids: split.known,
  };
}

export async function writePromptContext(
  root: string,
  prompt: string,
  modeOrOptions: PromptContextMode | WritePromptContextOptions,
  conversationId?: string,
): Promise<PromptContext> {
  const options =
    typeof modeOrOptions === "string"
      ? { mode: modeOrOptions, conversationId }
      : modeOrOptions;
  const payload = await buildPromptContext(root, prompt, options);
  const file = promptContextPath(root, payload.agent_id);
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWriteJson(file, payload);
  return payload;
}

export async function readPromptContext(
  root: string,
  conversationId?: string,
): Promise<PromptContext | null> {
  const file = promptContextPath(root, resolveAgentId(conversationId));
  return readJson<PromptContext>(file);
}
