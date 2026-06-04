import { unlink } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson, goalDir } from "./paths.js";

export type StopErrorFile = {
  kind: "verifier_error";
  at: string;
  message: string;
  hint?: string;
};

export function stopErrorPath(root: string): string {
  return path.join(goalDir(root), "stop-error.json");
}

function stopErrorHint(message: string): string | undefined {
  if (/acceptance must be a backticked shell command/i.test(message)) {
    return "Check GOAL.md acceptance lines: each value must be exactly one backticked shell command. Run: cursor-goal goal lint && cursor-goal compile.";
  }
  return undefined;
}

export async function writeStopError(root: string, error: unknown): Promise<StopErrorFile> {
  const message = error instanceof Error ? error.message : String(error);
  const data: StopErrorFile = {
    kind: "verifier_error",
    at: new Date().toISOString(),
    message,
    ...(stopErrorHint(message) ? { hint: stopErrorHint(message) } : {}),
  };
  await atomicWriteJson(stopErrorPath(root), data);
  return data;
}

export async function clearStopError(root: string): Promise<void> {
  await unlink(stopErrorPath(root)).catch(() => undefined);
}

export function formatStopVerifierError(error: unknown, written?: StopErrorFile): string {
  const message = error instanceof Error ? error.message : String(error);
  const hint = written?.hint ?? stopErrorHint(message);
  const detail = hint
    ? `${message}. ${hint} Details written to .cursor/goal/stop-error.json.`
    : `${message}. Details written to .cursor/goal/stop-error.json.`;
  return `cursor-goal stop verifier error: ${detail} Continuing - fix the verifier or GOAL state and re-run.`;
}
