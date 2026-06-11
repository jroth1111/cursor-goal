import { extractJsonObject } from "../lib/json-extract.js";
import { listDiffFiles } from "../lib/git.js";
import { retryTranscriptPath, runTurn, usageTokens, type TurnResult } from "../agent/runner.js";
import { ajvErrorText, validateReview, type GoalSpec, type ReviewResult } from "../state/schema.js";
import type { AgentCall } from "./decompose.js";
import { formatChangedFilesForPrompt } from "../lib/progressive-reveal.js";

function reviewPrompt(spec: GoalSpec, changedFiles: string[]): string {
  return [
    "You are a demanding staff engineer doing a final quality review before shipping.",
    "Be adversarial: assume the work is NOT good enough yet and look for what's wrong.",
    "INSPECT THE ACTUAL FILES in the repo (read the real code and tests) — do not guess.",
    "The acceptance checks already pass; your job is to find what passing checks does NOT prove.",
    "This may be any kind of software (CLI, library, service, data pipeline, parser, infra),",
    "not necessarily a web app — judge it by the standards of its actual domain.",
    "",
    `GOAL: ${spec.goal_text}`,
    spec.non_goals.length ? `NON-GOALS: ${spec.non_goals.join("; ")}` : "",
    changedFiles.length ? `Changed files: ${formatChangedFilesForPrompt(changedFiles)}` : "",
    "",
    "Review across these lenses (skip any that don't apply to this domain):",
    "1. REAL-BOUNDARY TESTS — do the tests exercise the real entry point a user hits (CLI",
    "   invocation, public API, real file/stdin I/O), or do they test private internals / mocks",
    "   of owned code? Tests against internals or mocks of your own code are a finding.",
    "2. EDGE & FAILURE COVERAGE — are empty, boundary, malformed, oversized, and error inputs",
    "   tested, and do failures degrade gracefully with clear messages (no silent except/catch,",
    "   no crash/hang/blank failure)? Happy-path-only is a finding.",
    "3. INVARIANTS NOT IMPLEMENTATION — do tests assert user-visible outcomes / contracts that",
    "   must stay true, rather than internal call counts or private state? Brittle impl-coupled",
    "   tests are a finding.",
    "4. CORRECTNESS — off-by-one, wrong defaults, mishandled edge values, broken contracts.",
    "5. ROBUSTNESS UNDER SCALE — does it handle large/realistic input without unbounded memory or",
    "   obvious O(n^2)+ behavior on the hot path? (resource/complexity, not micro-optimization)",
    "6. ERROR HANDLING — failures surfaced with actionable messages; no swallowed errors.",
    "7. DOCUMENTATION — is usage clear and complete for a new user; do examples actually run?",
    "8. SECURITY — injection, unsafe eval/exec, path traversal, secret handling, where relevant.",
    "9. MAINTAINABILITY — clear names, no dead code, reasonable structure.",
    "",
    "For EVERY finding include: severity, area (one lens above), the issue, a concrete fix,",
    "'evidence' (file:line or the exact command/input that exposes it — be specific, no speculation),",
    "and 'impact' (why it matters to a USER of this deliverable, not just a code observation).",
    "Add a runnable shell 'check' that would verify the fix whenever one exists.",
    "Do not invent problems: if a lens is genuinely fine, say nothing for it. Do not propose",
    "changes that merely add complexity or remove useful safety.",
    "",
    "severity: critical/high/medium are material (must fix); low is optional polish.",
    "Only set satisfied=true if a senior engineer would ship this AS-IS with no material concerns.",
    "",
    "Respond with ONLY this JSON object, no prose, no code fence:",
    '{"satisfied":false,"findings":[{"severity":"high","area":"edge-cases","issue":"...","fix":"...","evidence":"file.py:42 / `cmd < /dev/null`","impact":"...","check":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

export type ReviewOutcome = { review: ReviewResult; source: "llm" | "skip"; error?: string; tokens: number };

export const MATERIAL: ReadonlyArray<string> = ["critical", "high", "medium"];

/** Adversarial quality review of the finished deliverable; read-only (ask mode). */
export async function reviewGoal(
  spec: GoalSpec,
  root: string,
  call: AgentCall = runTurn,
  transcriptPath?: string,
): Promise<ReviewOutcome> {
  const changed = listDiffFiles(root);
  let lastErr = "";
  let tokens = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const note = attempt === 0 ? "" : "\n\nYour previous response was not valid JSON. Return ONLY the JSON object.";
    let result: TurnResult;
    try {
      result = await call({
        instruction: reviewPrompt(spec, changed) + note,
        mode: "ask",
        root,
        timeoutMs: 10 * 60 * 1000,
        transcriptPath: retryTranscriptPath(transcriptPath, attempt),
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
    tokens += usageTokens(result.usage);
    const obj = extractJsonObject(result.finalText);
    if (!obj) {
      lastErr = "no JSON object found";
      continue;
    }
    if (!validateReview(obj)) {
      lastErr = ajvErrorText(validateReview);
      continue;
    }
    return { review: obj as ReviewResult, source: "llm", tokens };
  }
  // If the reviewer can't produce structured output, do not block shipping on it.
  return { review: { satisfied: true, findings: [] }, source: "skip", error: lastErr, tokens };
}

export function materialFindings(review: ReviewResult): ReviewResult["findings"] {
  return review.findings.filter((f) => MATERIAL.includes(f.severity));
}
