import { extractJsonObject } from "../lib/json-extract.js";
import { runTurn, type TurnResult } from "../agent/runner.js";
import { ajvErrorText, validateVerdict, type Task, type Verdict } from "../state/schema.js";
import type { CheckResult } from "../lib/checks.js";
import { PREVIEW, PROOF_RUNS_ARTIFACT, revealForPrompt } from "../lib/progressive-reveal.js";
import { formatToolRunsForVerdict, readToolRunsSince, type ToolRunRow } from "../lib/tool-runs.js";
import type { ContextWindow } from "./context-window.js";
import type { AgentCall } from "./decompose.js";

export function verdictPrompt(
  task: Task,
  ctx: ContextWindow,
  checks: CheckResult[],
  agentSummary: string,
  diffFiles: string[],
  toolRuns: ToolRunRow[] = [],
): string {
  const checkLines = checks.length
    ? checks
        .map((c) =>
          `  - [${c.ok ? "PASS" : "FAIL"}] \`${c.cmd}\`${
            c.ok
              ? ""
              : `\n      ${revealForPrompt(c.output ?? "", { maxChars: PREVIEW.VERDICT_CHECK, tail: true }, PROOF_RUNS_ARTIFACT)}`
          }`,
        )
        .join("\n")
    : "  (no machine checks for this task)";
  return [
    "You are the verification brain for an autonomous coding driver. Judge ONLY the",
    "evidence below — do not explore the repo. Decide whether the task is complete and",
    "what the single best next action is.",
    "",
    `TASK (${task.id}): ${task.title}`,
    task.acceptance_prose ? `Acceptance (prose): ${task.acceptance_prose}` : "",
    "",
    "Acceptance check results:",
    checkLines,
    "",
    "Tool runs this turn (hook-captured ground truth; open output_artifact paths for full output):",
    formatToolRunsForVerdict(toolRuns),
    "",
    `Files changed this turn: ${diffFiles.length ? diffFiles.join(", ") : "(none)"}`,
    `Agent's own summary: ${revealForPrompt(agentSummary || "(empty)", { maxChars: PREVIEW.VERDICT_SUMMARY, tail: false })}`,
    ctx.tried_approaches.length ? `Already tried: ${ctx.tried_approaches.join("; ")}` : "",
    "",
    "next_action.kind meanings: continue (same session, do the instruction next);",
    "replan (the task is wrong/too big — break it down); switch_approach (retry fresh with a",
    "different tactic); escalate (a human is needed); none (task is complete).",
    "",
    "In evidence_seen, list artifact paths you relied on (e.g. tool output_artifact, proof-runs.jsonl).",
    "",
    "Respond with ONLY this JSON object, no prose, no code fence:",
    '{"task_complete":false,"confidence":0.0,"blockers":[],"next_action":{"kind":"continue","instruction":"...","rationale":"..."},"evidence_seen":[".cursor/goal/driver/evidence/..."]}',
  ]
    .filter(Boolean)
    .join("\n");
}

function coerceVerdict(value: unknown): Verdict | null {
  if (!validateVerdict(value)) return null;
  return value as Verdict;
}

export type VerdictResult = { verdict: Verdict; source: "llm" | "fallback"; error?: string };

/** Conservative verdict used when the LLM can't return valid JSON twice. */
export function fallbackVerdict(checks: CheckResult[], progressed: boolean): Verdict {
  const objectiveComplete = checks.length > 0 && checks.every((c) => c.ok);
  if (objectiveComplete) {
    return {
      task_complete: true,
      confidence: 0.6,
      blockers: [],
      next_action: { kind: "none", instruction: "", rationale: "all acceptance checks passed" },
    };
  }
  return {
    task_complete: false,
    confidence: 0.3,
    blockers: [],
    next_action: {
      kind: progressed ? "continue" : "switch_approach",
      instruction: progressed
        ? "Continue addressing the failing acceptance checks."
        : "No progress last turn — try a different approach to satisfy the acceptance checks.",
      rationale: "verdict model unavailable; objective-checks fallback",
    },
  };
}

/** Ask a read-only cursor-agent to judge supplied evidence; never lets bad JSON advance a task. */
export async function getVerdict(
  task: Task,
  ctx: ContextWindow,
  checks: CheckResult[],
  agentSummary: string,
  diffFiles: string[],
  root: string,
  progressed: boolean,
  turnStartedAtMs: number,
  call: AgentCall = runTurn,
): Promise<VerdictResult> {
  const toolRuns = await readToolRunsSince(root, turnStartedAtMs);
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const note =
      attempt === 0 ? "" : "\n\nYour previous response was not valid JSON. Return ONLY the JSON object.";
    let result: TurnResult;
    try {
      result = await call({
        instruction: verdictPrompt(task, ctx, checks, agentSummary, diffFiles, toolRuns) + note,
        mode: "ask",
        root,
        timeoutMs: 3 * 60 * 1000,
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
    const obj = extractJsonObject(result.finalText);
    if (!obj) {
      lastErr = "no JSON object found";
      continue;
    }
    const verdict = coerceVerdict(obj);
    if (!verdict) {
      lastErr = ajvErrorText(validateVerdict);
      continue;
    }
    return { verdict, source: "llm" };
  }
  return { verdict: fallbackVerdict(checks, progressed), source: "fallback", error: lastErr };
}
