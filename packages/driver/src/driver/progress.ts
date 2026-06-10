import type { RunState } from "../state/schema.js";

const RING_SIZE = 8;

/** Append a working-tree fingerprint to the bounded ring (most recent last). */
export function pushFingerprint(run: RunState, fp: string): void {
  run.fingerprint_ring.push(fp);
  if (run.fingerprint_ring.length > RING_SIZE) {
    run.fingerprint_ring = run.fingerprint_ring.slice(-RING_SIZE);
  }
}

/**
 * Oscillation = the new fingerprint equals an earlier non-adjacent ring entry
 * (A -> B -> A), i.e. the agent is undoing and redoing the same change. This is
 * distinct from no-progress (A -> A) and warrants a different tactic, not a retry.
 */
export function isOscillating(run: RunState, fp: string): boolean {
  const ring = run.fingerprint_ring;
  if (ring.length < 2) return false;
  for (let i = 0; i < ring.length - 1; i++) {
    if (ring[i] === fp) return true;
  }
  return false;
}

export const NO_PROGRESS_LIMIT = 2;

export function noProgressExhausted(run: RunState): boolean {
  return run.no_progress_streak >= NO_PROGRESS_LIMIT;
}
