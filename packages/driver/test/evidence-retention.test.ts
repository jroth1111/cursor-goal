import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { enforceEvidenceRetention } from "../src/lib/evidence-retention.js";
import { parseDriverSection } from "../src/driver/intake.js";
import { readJournalTail } from "../src/lib/journal.js";
import { evidenceDir } from "../src/lib/paths.js";
import { initRun, materializeGraph } from "../src/state/store.js";
import type { GoalSpec, RunState, TaskGraph } from "../src/state/schema.js";
import { mkGitProject, type Project } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const spec = (capMb?: number): GoalSpec => ({
  goal_text: "g",
  source: "prompt",
  acceptance_checks: [],
  non_goals: [],
  scope: [],
  driver_defaults: capMb != null ? { evidence_cap_mb: capMb } : {},
});

/** Write a file of `kb` KB under evidence/<sub>/ with a deterministic age. */
function seedArtifact(root: string, sub: string, name: string, kb: number, ageMinutes: number): string {
  const dir = path.join(evidenceDir(root), sub);
  mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, name);
  writeFileSync(abs, "x".repeat(kb * 1024));
  const t = new Date(Date.now() - ageMinutes * 60_000);
  utimesSync(abs, t, t);
  return abs;
}

async function runFor(p: Project, capMb: number): Promise<RunState> {
  // cap is carried by goal_spec.driver_defaults; initRun needs the root for baseline
  return initRun(spec(capMb), p.root);
}

describe("evidence retention", () => {
  it("over cap: oldest files are dropped first until under cap, and the pass is journaled", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const oldest = seedArtifact(p.root, "tool-outputs", "ancient.txt", 300, 60);
    const middle = seedArtifact(p.root, "turn-failures", "middle.txt", 300, 30);
    const newest = seedArtifact(p.root, "turns", "fresh.jsonl", 300, 1);
    const run = await runFor(p, 0.6); // cap ≈ 614KB; total 900KB

    const outcome = await enforceEvidenceRetention(p.root, run, { tasks: [] });
    expect(outcome).not.toBeNull();
    expect(outcome!.removedFiles).toBe(1); // dropping the oldest brings 900->600KB under 614KB
    expect(existsSync(oldest)).toBe(false);
    expect(existsSync(middle)).toBe(true);
    expect(existsSync(newest)).toBe(true);

    const journal = await readJournalTail(p.root, 10);
    const note = journal.find((e) => /evidence retention/.test(e.note ?? ""));
    expect(note).toBeDefined();
    expect(note!.note).toMatch(/removed 1 file/);
  });

  it("artifacts referenced by non-done tasks or residual findings survive even when oldest", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const protectedPtr = seedArtifact(p.root, "tool-outputs", "live-proof.txt", 300, 120);
    const protectedFail = seedArtifact(p.root, "turn-failures", "live-failure.txt", 300, 110);
    const protectedResidual = seedArtifact(p.root, "turns", "residual-evidence.jsonl", 300, 100);
    const expendable = seedArtifact(p.root, "tool-outputs", "old-but-done.txt", 300, 90);

    const protectedResidual2 = seedArtifact(p.root, "turn-failures", "residual-2.md", 50, 95);
    const rel = (abs: string) => path.relative(p.root, abs);
    const graph: TaskGraph = materializeGraph({
      tasks: [
        { id: "live", title: "live", kind: "implement", deps: [], acceptance_checks: ["true"], acceptance_prose: "" },
      ],
    });
    graph.tasks[0].status = "in_progress";
    graph.tasks[0].evidence.proof_ptrs = [rel(protectedPtr)];
    graph.tasks[0].last_failure_artifact = rel(protectedFail);

    const run = await runFor(p, 0.3); // cap ≈ 307KB; total >1200KB — heavy pressure
    run.residual_findings = [
      // two paths in one finding, the second wrapped in prose punctuation:
      // BOTH must be protected (a first-match-only regex protected just one)
      {
        severity: "high",
        area: "x",
        issue: "i",
        fix: "f",
        evidence: `see ${rel(protectedResidual)} line 3 (and ${rel(protectedResidual2)}).`,
      },
    ];

    const outcome = await enforceEvidenceRetention(p.root, run, graph);
    expect(outcome).not.toBeNull();
    expect(existsSync(protectedPtr)).toBe(true);
    expect(existsSync(protectedFail)).toBe(true);
    expect(existsSync(protectedResidual)).toBe(true);
    expect(existsSync(protectedResidual2)).toBe(true); // second path in the same finding
    expect(existsSync(expendable)).toBe(false); // the only unprotected file went
  });

  it("under cap is a silent no-op; indexes and baseline are never candidates", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    seedArtifact(p.root, "turns", "small.jsonl", 10, 5);
    // index + baseline live outside the rotatable dirs
    writeFileSync(path.join(evidenceDir(p.root), "proof-runs.jsonl"), "x".repeat(700 * 1024));
    mkdirSync(path.join(evidenceDir(p.root), "baseline"), { recursive: true });
    writeFileSync(path.join(evidenceDir(p.root), "baseline", "dirty.patch"), "x".repeat(700 * 1024));

    const run = await runFor(p, 0.5);
    const outcome = await enforceEvidenceRetention(p.root, run, { tasks: [] });
    expect(outcome).toBeNull(); // rotatable total is tiny; indexes/baseline don't count
    expect(existsSync(path.join(evidenceDir(p.root), "proof-runs.jsonl"))).toBe(true);
    expect(existsSync(path.join(evidenceDir(p.root), "baseline", "dirty.patch"))).toBe(true);
    const journal = await readJournalTail(p.root, 10);
    expect(journal.some((e) => /evidence retention/.test(e.note ?? ""))).toBe(false);
  });

  it("evidence_cap_mb is a recognized Driver config key", () => {
    const { defaults, warnings } = parseDriverSection(
      ["## Driver", "", "- evidence_cap_mb: 250", ""].join("\n"),
    );
    expect(warnings).toEqual([]);
    expect(defaults.evidence_cap_mb).toBe(250);
  });
});
