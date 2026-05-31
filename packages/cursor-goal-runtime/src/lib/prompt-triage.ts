import { existsSync } from "node:fs";
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { readGovernanceConfig, readSessionMode, type GovernanceMode } from "./governance-config.js";
import { goalDir, goalMd, readJson } from "./paths.js";
import { isAgentSubmitBlocked } from "./disposition.js";
import { resolveAgentId } from "./runtime-state.js";
import { hashPrompt } from "./explain-stop.js";

export type EffectiveMode = "chat" | "nudge" | "governed";

export type PromptClassification = {
  chatScore: number;
  deliveryScore: number;
  coverageScore: number;
  forceGoverned: boolean;
  reasons: string[];
};

const ANTI_CHAT =
  /\b(how|why|what is|what's|explain|compare|review only|read-only|read only|don't edit|do not edit|without editing)\b/i;
const ANTI_GOVERNANCE = /\b(no goal|no governance|ungoverned|un governed)\b/i;
const DELIVERY =
  /\b(implement|fix|add|migrate|refactor|ship|build|wire up|until .+ pass|must pass|before merge)\b/i;
const COVERAGE =
  /\b(every|all|each|full|entire|complete coverage)\b.+\b(page|pages|route|routes|endpoint|endpoints|screen|screens|url|urls)\b|\b(test|audit|verify).+\b(every|all|each)\b/i;
const FORCE_GOVERNED = /(?:^|\s)\/goal\b|\bcursor-goal\s+govern\b/i;

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

  if (FORCE_GOVERNED.test(text)) {
    forceGoverned = true;
    reasons.push("explicit-governed");
  }
  if (/\bcursor-goal\s+init\b/i.test(text)) {
    forceGoverned = true;
    reasons.push("cursor-goal-init");
  }
  if (ANTI_CHAT.test(text)) {
    chatScore += 2;
    reasons.push("question-shape");
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

export type ResolveModeResult = {
  mode: EffectiveMode;
  nudgeKind?: "delivery" | "coverage";
};

export async function resolveEffectiveMode(
  root: string,
  prompt: string,
  conversationId?: string,
): Promise<ResolveModeResult> {
  const config = await readGovernanceConfig(root);
  const session = await readSessionMode(root);
  const classified = classifyPrompt(prompt);
  const agentId = resolveAgentId(conversationId);

  if (session?.mode === "chat") {
    if (await isBlockedRuntime(root, agentId)) {
      return { mode: "governed" };
    }
    return { mode: "chat" };
  }

  if (session?.mode === "governed") {
    return { mode: "governed" };
  }

  if (config.default_mode === "governed") {
    return { mode: "governed" };
  }

  if ((await hasGovernedContract(root)) || (await isBlockedRuntime(root, agentId))) {
    return { mode: "governed" };
  }

  if (classified.forceGoverned) {
    return { mode: "governed" };
  }

  if (classified.chatScore >= 2 && classified.deliveryScore === 0) {
    return { mode: "chat" };
  }

  if (config.default_mode === "chat") {
    return { mode: "chat" };
  }

  if (classified.coverageScore >= 2) {
    return { mode: "nudge", nudgeKind: "coverage" };
  }

  if (classified.deliveryScore >= 2) {
    return { mode: "nudge", nudgeKind: "delivery" };
  }

  return { mode: "chat" };
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
};

function triageLogPath(root: string): string {
  return path.join(goalDir(root), "triage-log.jsonl");
}

export async function appendTriageLog(
  root: string,
  prompt: string,
  mode: EffectiveMode,
  conversationId?: string,
): Promise<void> {
  const classification = classifyPrompt(prompt);
  const entry: TriageLogEntry = {
    at: new Date().toISOString(),
    agent_id: resolveAgentId(conversationId),
    mode,
    classification,
    reasons: classification.reasons,
    prompt_hash: hashPrompt(prompt),
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
