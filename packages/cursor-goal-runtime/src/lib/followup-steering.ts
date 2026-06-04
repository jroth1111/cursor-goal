import type { NextActionKind } from "./next-action.js";
import { createHash } from "node:crypto";

const MAX_CURSOR_FOLLOWUP_CHARS = 1600;

export function isNearLoopBudget(loopCount: number, loopLimit: number): boolean {
  return loopCount >= loopLimit - 2;
}

export function loopBudgetSteeringBlurb(loopCount: number, loopLimit: number): string {
  return [
    "Loop budget nearly exhausted — do not start new work units or large rewrites.",
    `You are at ${loopCount}/${loopLimit} blocked stops. Summarize progress, list remaining units/blockers, and take the smallest fix toward the primary blocker below.`,
    "RELEASE still requires passing GOAL checks and closing open units; running out of loops is not the same as finishing the goal.",
  ].join("\n");
}

const CONTINUATION_PRIMARY: Set<NextActionKind> = new Set([
  "dispatch_unit",
  "verify_unit",
  "fix_checks",
  "fix_scope",
  "fix_stale_proof",
]);

export function shouldShowContinuationBlurb(
  phase: string,
  primaryKind: NextActionKind | string,
): boolean {
  if (phase !== "IMPLEMENT" && phase !== "VERIFY") return false;
  return CONTINUATION_PRIMARY.has(primaryKind as NextActionKind);
}

export function blockedWorkContinuationBlurb(phase: string, primaryKind: string): string {
  return [
    "Continue toward the full GOAL objective (see GOAL.md / .cursor/goal/intent.json).",
    "Do not redefine success as re-running verification on existing artifacts unless this unit's role is verify.",
    "Treat the worktree as source of truth — re-read files before claiming done; chat memory is hints only.",
    `Phase ${phase}; primary blocker: ${primaryKind}. Make concrete progress on that blocker this turn.`,
  ].join("\n");
}

function stopSig(message: string): string {
  return createHash("sha256").update(message.trim()).digest("hex").slice(0, 12);
}

function redactPromptLikeText(message: string): string {
  const lines = message.split(/\r?\n/);
  const out: string[] = [];
  let redacting = false;
  for (const line of lines) {
    if (/^\s*(Task prompt:|##\s*Task prompt\b)/i.test(line)) {
      if (!redacting) out.push("[redacted task prompt]");
      redacting = true;
      continue;
    }
    if (redacting && /^\s*#{1,3}\s+\S/.test(line) && !/task prompt/i.test(line)) {
      redacting = false;
    }
    if (redacting) continue;
    if (/\b(work_unit_id:|Complete work unit|Stop after this unit's acceptance criteria)/i.test(line)) {
      if (!out[out.length - 1]?.includes("redacted task prompt")) {
        out.push("[redacted task prompt]");
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

export function formatCursorQueuedFollowup(message: string): string {
  const redacted = redactPromptLikeText(message);
  const withoutTag = redacted.replace(/^\[governance\]\s*/i, "").trim();
  const signed = `[governance] stop_sig=${stopSig(withoutTag)} ${withoutTag}`.trim();
  if (signed.length <= MAX_CURSOR_FOLLOWUP_CHARS) return signed;
  const suffix = "\n[truncated: run cursor-goal status --conversation <id> for full state]";
  return `${signed.slice(0, MAX_CURSOR_FOLLOWUP_CHARS - suffix.length).trimEnd()}${suffix}`;
}

export function oscillationSteeringBlurb(signatures: string[]): string {
  const displaySigs = signatures.map((s) => {
    const short = s.length > 60 ? `${s.slice(0, 57)}...` : s;
    return short;
  });
  return [
    "Detected oscillation between strategies:",
    ...displaySigs.map((s) => `  - ${s}`),
    "",
    "Try a fundamentally different approach — do not re-attempt any strategy from the last 3 stops.",
    "If the blocker is a check failure, read the test output carefully and address the root cause rather than re-running.",
  ].join("\n");
}
