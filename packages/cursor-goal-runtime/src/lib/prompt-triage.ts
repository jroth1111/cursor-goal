import { existsSync } from "node:fs";
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { readGovernanceConfig, readSessionMode, type GovernanceMode } from "./governance-config.js";
import { goalDir, goalMd, readJson } from "./paths.js";
import { isAgentSubmitBlocked } from "./disposition.js";
import { resolveAgentId } from "./runtime-state.js";
import { hashPrompt } from "./explain-stop.js";

export type EffectiveMode = "chat" | "nudge" | "governed";
export type InteractionModeHint = "chat" | "delivery";

export type PromptClassification = {
  chatScore: number;
  deliveryScore: number;
  coverageScore: number;
  forceGoverned: boolean;
  reasons: string[];
};

const ANTI_CHAT =
  /\b(how|why|what is|what's|explain|compare|review only|read-only|read only|don't edit|do not edit|without editing)\b/i;
const READ_ONLY_OPT_OUT = /\b(review only|read-only|read only|don't edit|do not edit|without editing)\b/i;
const ANTI_GOVERNANCE = /\b(no goal|no governance|ungoverned|un governed)\b/i;
const DELIVERY =
  /\b(implement|fix|add|migrate|refactor|ship|build|wire up|until .+ pass|must pass|before merge)\b/i;
const COVERAGE =
  /\b(every|all|each|full|entire|complete coverage)\b.+\b(page|pages|route|routes|endpoint|endpoints|screen|screens|url|urls)\b|\b(test|audit|verify).+\b(every|all|each)\b/i;
export type GoalSlashAction = "pause" | "resume" | "continue" | "govern" | "none";

export function parseGoalSlashAction(prompt: string): GoalSlashAction {
  const text = prompt.trim();
  const m = text.match(/^\/goal(?:\s+(.+))?$/i);
  if (!m) return "none";
  const rest = (m[1] ?? "").trim().toLowerCase();
  if (!rest) return "govern";
  const verb = rest.split(/\s+/)[0];
  if (verb === "pause") return "pause";
  if (verb === "resume") return "resume";
  if (verb === "continue") return "continue";
  return "govern";
}

export function classifyPrompt(prompt: string): PromptClassification {
  const text = prompt.trim();
  const reasons: string[] = [];
  let chatScore = 0;
  let deliveryScore = 0;
  let coverageScore = 0;
  let forceGoverned = false;

  if (!text) {
    return { chatScore: 1, deliveryScore: 0, coverageScore: 0, forceGoverned: false, reasons: ["empty"] };
  }

  const goalSlashAction = parseGoalSlashAction(text);
  if (goalSlashAction === "continue" || goalSlashAction === "govern") {
    forceGoverned = true;
    reasons.push("explicit-governed");
  }
  if (/\bcursor-goal\s+govern\b/i.test(text)) {
    forceGoverned = true;
    reasons.push("cursor-goal-govern");
  }
  if (/\bcursor-goal\s+init\b/i.test(text)) {
    forceGoverned = true;
    reasons.push("cursor-goal-init");
  }
  if (ANTI_CHAT.test(text)) {
    chatScore += 2;
    reasons.push("question-shape");
  }
  if (READ_ONLY_OPT_OUT.test(text)) {
    chatScore += 3;
    reasons.push("read-only-opt-out");
  }
  if (ANTI_GOVERNANCE.test(text)) {
    chatScore += 3;
    reasons.push("opt-out");
  }
  if (DELIVERY.test(text)) {
    deliveryScore += 2;
    reasons.push("delivery-verbs");
  }
  if (COVERAGE.test(text)) {
    coverageScore += 2;
    deliveryScore += 1;
    reasons.push("coverage-quantifier");
  }

  return { chatScore, deliveryScore, coverageScore, forceGoverned, reasons };
}

export async function hasGovernedContract(root: string): Promise<boolean> {
  if (!existsSync(goalMd(root))) return false;
  const checksFile = path.join(goalDir(root), "checks.json");
  if (existsSync(checksFile)) {
    const checks = await readJson<{ commands?: string[] }>(checksFile);
    if (checks?.commands && checks.commands.length > 0) return true;
  }
  try {
    const { parseGoalMd } = await import("./parse-goal-md.js");
    const parsed = await parseGoalMd(root);
    return parsed.checks.length > 0;
  } catch {
    return false;
  }
}

export async function isBlockedRuntime(
  root: string,
  agentId?: string,
): Promise<boolean> {
  const id = agentId ?? "default";
  return isAgentSubmitBlocked(root, id);
}

/** `/goal` or `cursor-goal govern` — must win over session chat pin. */
export function shouldForceGovernedSession(classified: PromptClassification): boolean {
  return classified.forceGoverned;
}

/** Persist session to governed after triage (survives follow-up prompts). */
export function shouldPersistGovernedSession(
  classified: PromptClassification,
  resolvedMode: EffectiveMode,
  config: { default_mode: GovernanceMode },
  hasContract: boolean,
): boolean {
  if (resolvedMode === "governed") return true;
  if (classified.forceGoverned) return true;
  void config;
  void hasContract;
  return false;
}

export type ResolveModeResult = {
  mode: EffectiveMode;
  nudgeKind?: "delivery" | "coverage";
  triageReasons?: string[];
  interactionModeHint: InteractionModeHint;
};

function result(
  mode: EffectiveMode,
  extra: Omit<ResolveModeResult, "mode" | "interactionModeHint"> = {},
): ResolveModeResult {
  return {
    mode,
    ...extra,
    interactionModeHint: mode === "chat" ? "chat" : "delivery",
  };
}

export async function resolveEffectiveMode(
  root: string,
  prompt: string,
  conversationId?: string,
): Promise<ResolveModeResult> {
  const config = await readGovernanceConfig(root);
  const session = await readSessionMode(root);
  const classified = classifyPrompt(prompt);
  const agentId = resolveAgentId(conversationId);
  const blocked = await isBlockedRuntime(root, agentId);

  if (shouldForceGovernedSession(classified)) {
    return result("governed", { triageReasons: ["explicit_governed"] });
  }

  if (session?.mode === "chat") {
    if (blocked) {
      return result("governed", { triageReasons: ["blocked_runtime"] });
    }
    return result("chat");
  }

  if (session?.mode === "governed") {
    return result("governed");
  }

  if (config.default_mode === "governed") {
    return result("governed");
  }

  if (blocked) {
    return result("governed", { triageReasons: ["blocked_runtime"] });
  }

  if (config.default_mode === "chat") {
    return result("chat");
  }

  if (classified.reasons.includes("read-only-opt-out") || classified.reasons.includes("opt-out")) {
    return result("chat");
  }

  if (classified.chatScore >= 2 && classified.deliveryScore === 0) {
    return result("chat");
  }

  if (classified.coverageScore >= 2) {
    return result("nudge", { nudgeKind: "coverage" });
  }

  if (classified.deliveryScore >= 2) {
    return result("nudge", { nudgeKind: "delivery" });
  }

  // In auto mode, a compiled GOAL contract is a release contract, not prompt
  // authority. It should not turn ordinary chat into governed execution.
  return result("chat");
}

export function nudgeMessage(kind: "delivery" | "coverage"): string {
  if (kind === "coverage") {
    return (
      "Full-coverage task detected. Run: cursor-goal init — add ## Inventory and a failing " +
      "coverage check (e.g. node .cursor/goal/scripts/verify-coverage.js). " +
      "Or: cursor-goal mode governed"
    );
  }
  return (
    "Delivery-style task detected. Run: cursor-goal init — then edit ## Checks and ## Scope. " +
    "Or: cursor-goal mode governed"
  );
}

export function formatModeStatus(
  config: { default_mode: GovernanceMode },
  session: { mode: string } | null,
): string {
  const parts = [`default_mode=${config.default_mode}`];
  if (session) parts.push(`session_mode=${session.mode}`);
  else parts.push("session_mode=(none)");
  return parts.join(" ");
}

export type TriageLogEntry = {
  at: string;
  agent_id: string;
  mode: EffectiveMode;
  classification: PromptClassification;
  reasons: string[];
  prompt_hash: string;
  interaction_mode_hint?: InteractionModeHint;
};

function triageLogPath(root: string): string {
  return path.join(goalDir(root), "triage-log.jsonl");
}

export async function appendTriageLog(
  root: string,
  prompt: string,
  mode: EffectiveMode,
  conversationId?: string,
  extraReasons?: string[],
  interactionModeHint?: InteractionModeHint,
): Promise<void> {
  const classification = classifyPrompt(prompt);
  const reasons = extraReasons?.length
    ? [...new Set([...classification.reasons, ...extraReasons])]
    : classification.reasons;
  const entry: TriageLogEntry = {
    at: new Date().toISOString(),
    agent_id: resolveAgentId(conversationId),
    mode,
    classification,
    reasons,
    prompt_hash: hashPrompt(prompt),
    ...(interactionModeHint ? { interaction_mode_hint: interactionModeHint } : {}),
  };
  const file = triageLogPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readLastTriageEntry(
  root: string,
  conversationId?: string,
): Promise<TriageLogEntry | null> {
  const file = triageLogPath(root);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const agentId = resolveAgentId(conversationId);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as TriageLogEntry;
      if (parsed.agent_id === agentId) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}
