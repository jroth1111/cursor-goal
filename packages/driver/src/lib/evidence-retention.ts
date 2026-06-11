import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { appendJournal } from "./journal.js";
import { evidenceDir } from "./paths.js";
import type { RunState, TaskGraph } from "../state/schema.js";

/**
 * Bounded disk for the evidence story. Long-horizon runs accumulate full tool
 * outputs, turn failures, and NDJSON transcripts without limit — gigabytes under
 * .cursor/goal/driver/ is how the feature gets disabled by annoyed users. This is
 * an overflow valve, not a space optimizer: the default cap is generous, oldest
 * artifacts go first, and anything a non-done task or residual finding still
 * references is never dropped. Index files (proof-runs/tool-runs) and the
 * baseline snapshot are never candidates at all.
 */

const DEFAULT_CAP_MB = 500;

/** The bulky, rotatable evidence dirs (relative to evidence/). */
const ROTATABLE = ["tool-outputs", "turn-failures", "turns"];

export type RetentionOutcome = { removedFiles: number; removedBytes: number };

export function evidenceCapBytes(run: RunState): number {
  const mb = run.goal_spec.driver_defaults?.evidence_cap_mb ?? DEFAULT_CAP_MB;
  return mb * 1024 * 1024;
}

function protectedPaths(root: string, run: RunState, graph: TaskGraph | null): Set<string> {
  const out = new Set<string>();
  const add = (rel: string | null | undefined) => {
    if (rel) out.add(path.resolve(root, rel));
  };
  for (const t of graph?.tasks ?? []) {
    if (t.status === "done") continue; // a live task's evidence is hot
    for (const p of t.evidence.proof_ptrs) add(p);
    add(t.last_failure_artifact);
  }
  for (const f of run.residual_findings) {
    // every path in the finding (not just the first), with trailing prose
    // punctuation trimmed AFTER the match — excluding '.' from the match itself
    // would truncate real extensions like .jsonl/.md
    for (const m of f.evidence?.matchAll(/\.cursor\/goal\/driver\/evidence\/\S+/g) ?? []) {
      add(m[0].replace(/[).,;:]+$/, ""));
    }
  }
  return out;
}

export async function enforceEvidenceRetention(
  root: string,
  run: RunState,
  graph: TaskGraph | null,
): Promise<RetentionOutcome | null> {
  try {
    const cap = evidenceCapBytes(run);
    const candidates: string[] = [];
    for (const sub of ROTATABLE) {
      const dir = path.join(evidenceDir(root), sub);
      if (!existsSync(dir)) continue;
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isFile()) candidates.push(path.join(dir, e.name));
      }
    }
    // batched stats: this runs at every task_done, so serialized round-trips
    // would scale with the run's whole artifact history
    const stats = await Promise.all(candidates.map((abs) => stat(abs)));
    const files = candidates.map((abs, i) => ({ abs, size: stats[i].size, mtimeMs: stats[i].mtimeMs }));
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= cap) return null;

    const protect = protectedPaths(root, run, graph);
    files.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
    let removedFiles = 0;
    let removedBytes = 0;
    for (const f of files) {
      if (total - removedBytes <= cap) break;
      if (protect.has(path.resolve(f.abs))) continue;
      await rm(f.abs, { force: true });
      removedFiles += 1;
      removedBytes += f.size;
    }
    if (removedFiles > 0) {
      await appendJournal(root, {
        at: new Date().toISOString(),
        kind: "lifecycle",
        note: `evidence retention: removed ${removedFiles} file(s) / ${(removedBytes / (1024 * 1024)).toFixed(1)} MB (cap ${(cap / (1024 * 1024)).toFixed(0)} MB; rotated pointers remain as provenance)`,
      });
    }
    return { removedFiles, removedBytes };
  } catch {
    return null; // retention must never hurt a run
  }
}
