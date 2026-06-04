import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir } from "./paths.js";
import type { VerifierContext } from "../verifier/types.js";
import type { StopTraceEntry } from "./stop-trace.js";

export const REPEATED_FAILURE_DISPOSITION_THRESHOLD = 3;

export type StopSignatureEntry = {
  at: string;
  signature: string;
};

export function computeStopSignature(
  failures: string[],
  levelFailed: string | null,
): string {
  const sorted = [...failures].sort().join("|");
  return `${levelFailed ?? "none"}::${sorted}`;
}

function agentSignaturesPath(root: string, agentId: string): string {
  return path.join(goalDir(root), "agents", agentId, "stop-signatures.jsonl");
}

export async function recordStopSignature(
  root: string,
  agentId: string,
  signature: string,
): Promise<number> {
  const file = agentSignaturesPath(root, agentId);
  await mkdir(path.dirname(file), { recursive: true });
  const entry: StopSignatureEntry = {
    at: new Date().toISOString(),
    signature,
  };
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  return countTrailingSignature(root, agentId, signature);
}

export async function readStopSignatureTail(
  root: string,
  agentId: string,
  n = 10,
): Promise<StopSignatureEntry[]> {
  const file = agentSignaturesPath(root, agentId);
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const out: StopSignatureEntry[] = [];
  for (const line of lines.slice(-n)) {
    try {
      out.push(JSON.parse(line) as StopSignatureEntry);
    } catch {
      continue;
    }
  }
  return out;
}

export async function countTrailingSignature(
  root: string,
  agentId: string,
  signature: string,
): Promise<number> {
  const tail = await readStopSignatureTail(root, agentId, REPEATED_FAILURE_DISPOSITION_THRESHOLD);
  let count = 0;
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    if (tail[i].signature !== signature) break;
    count += 1;
  }
  return count;
}

export function shouldDispositionForRepeat(trailingCount: number): boolean {
  return trailingCount >= REPEATED_FAILURE_DISPOSITION_THRESHOLD;
}

export function repeatedFailureHint(trailingCount: number): string | null {
  if (trailingCount < 2 || trailingCount >= REPEATED_FAILURE_DISPOSITION_THRESHOLD) {
    return null;
  }
  return `repeated_failure: ${trailingCount}/${REPEATED_FAILURE_DISPOSITION_THRESHOLD}`;
}

export function computeSignatureFromContext(
  ctx: VerifierContext,
  levelFailed: string | null,
): string {
  return computeStopSignature(ctx.failures, levelFailed);
}

/**
 * Detect oscillation: any signature repeated within the last N stops.
 * Returns the repeated signatures and their counts, or null if no oscillation.
 */
export function detectOscillation(
  entries: StopSignatureEntry[],
  window = 5,
): { signatures: string[]; counts: Map<string, number> } | null {
  if (entries.length < 3) return null;
  const recent = entries.slice(-window);
  const counts = new Map<string, number>();
  for (const e of recent) {
    counts.set(e.signature, (counts.get(e.signature) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].filter(([, c]) => c >= 2).map(([sig]) => sig);
  if (repeated.length === 0) return null;
  return { signatures: repeated, counts };
}

/**
 * Detect token stagnation: output tokens grew but check results didn't improve.
 * Returns true if the last N traces show non-zero output_tokens but
 * pipeline_result stayed "continue" throughout.
 */
export function detectTokenStagnation(
  traces: StopTraceEntry[],
  window = 5,
): boolean {
  if (traces.length < 3) return false;
  const recent = traces.slice(-window);
  const allContinuing = recent.every((t) => t.pipeline_result === "continue");
  const anyTokensGrowing = recent.some(
    (t) => (t.token_usage?.output_tokens ?? 0) > 0,
  );
  return allContinuing && anyTokensGrowing;
}
