import { extractJsonObject } from "../lib/json-extract.js";
import { listDiffFiles } from "../lib/git.js";
import { runTurn, type TurnResult } from "../agent/runner.js";
import { ajvErrorText, validateReview, type GoalSpec, type ReviewResult } from "../state/schema.js";
import type { AgentCall } from "./decompose.js";

function reviewPrompt(spec: GoalSpec, changedFiles: string[]): string {
  return [
    "You are a demanding staff engineer doing a final quality review before shipping.",
    "Be adversarial: assume the work is NOT good enough yet and look for what's wrong.",
    "INSPECT THE ACTUAL FILES in the repo — do not guess. The acceptance checks already",
    "pass; your job is everything passing checks does not prove.",
    "",
    `GOAL: ${spec.goal_text}`,
    spec.non_goals.length ? `NON-GOALS: ${spec.non_goals.join("; ")}` : "",
    changedFiles.length ? `Changed files: ${changedFiles.slice(0, 40).join(", ")}` : "",
    "",
    "Review across these lenses and report concrete, actionable deficiencies:",
    "- correctness & edge cases (empty/large/unicode/boundary inputs, off-by-one, error paths)",
    "- robustness & error handling (failures surfaced clearly, no silent except/catch)",
    "- test depth (are the tests meaningful and do they cover the edge cases, not just happy path?)",
    "- documentation (is usage clear and complete for a new user?)",
    "- security (injection, unsafe eval/exec, path traversal, secrets) where relevant",
    "- maintainability (clear names, no dead code, reasonable structure)",
    "",
    "severity: critical/high/medium are material (must fix); low is optional polish.",
    "Only set satisfied=true if a senior engineer would ship this AS-IS with no material concerns.",
    "Each finding needs a concrete 'fix'; add a runnable shell 'check' that would verify the fix when possible.",
    "",
    "Respond with ONLY this JSON object, no prose, no code fence:",
    '{"satisfied":false,"findings":[{"severity":"high","area":"edge-cases","issue":"...","fix":"...","check":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

export type ReviewOutcome = { review: ReviewResult; source: "llm" | "skip"; error?: string };

export const MATERIAL: ReadonlyArray<string> = ["critical", "high", "medium"];

/** Adversarial quality review of the finished deliverable; read-only (ask mode). */
export async function reviewGoal(
  spec: GoalSpec,
  root: string,
  call: AgentCall = runTurn,
): Promise<ReviewOutcome> {
  const changed = listDiffFiles(root);
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const note = attempt === 0 ? "" : "\n\nYour previous response was not valid JSON. Return ONLY the JSON object.";
    let result: TurnResult;
    try {
      result = await call({
        instruction: reviewPrompt(spec, changed) + note,
        mode: "ask",
        root,
        timeoutMs: 5 * 60 * 1000,
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
    if (!validateReview(obj)) {
      lastErr = ajvErrorText(validateReview);
      continue;
    }
    return { review: obj as ReviewResult, source: "llm" };
  }
  // If the reviewer can't produce structured output, do not block shipping on it.
  return { review: { satisfied: true, findings: [] }, source: "skip", error: lastErr };
}

export function materialFindings(review: ReviewResult): ReviewResult["findings"] {
  return review.findings.filter((f) => MATERIAL.includes(f.severity));
}
