import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runGoal } from "../src/driver/loop.js";
import { runLogs } from "../src/driver/logs.js";
import { formatProgress, type ProgressEvent } from "../src/driver/progress-io.js";
import { readJournalTail } from "../src/lib/journal.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/**
 * The cross-surface invariant of the observability feature: an operator can
 * correlate a stderr progress line to a journal entry to a transcript file by
 * turn number, and `logs` retells the same story. If these surfaces drift apart,
 * debugging trust dies — so the whole story is pinned here. On failure the full
 * journal is printed so a regression is diagnosable from CI output alone.
 */
describe("observability end-to-end", () => {
  it("journal, transcripts, progress feed, and logs agree turn-by-turn", async () => {
    const goalMd =
      "# Goal\n\n## Goal\nObservable goal\n\n## Checks\n\n- `test -f a.txt`\n- `test -f b.txt`\n";
    const p: Project = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);

    const scenario: Scenario = {
      plan: {
        tasks: [
          { id: "build-a", title: "make a", kind: "implement", deps: [], acceptance_checks: ["test -f a.txt"], acceptance_prose: "" },
          { id: "build-b", title: "make b", kind: "implement", deps: ["build-a"], acceptance_checks: ["test -f b.txt"], acceptance_prose: "" },
        ],
      },
      verdicts: [{ task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "actually write b" } }],
      turns: [
        { mutate: [{ file: "a.txt", content: "a" }] }, // turn 1: build-a done
        { delta: "thinking" }, // turn 2: build-b fails checks -> continue
        { mutate: [{ file: "b.txt", content: "b" }] }, // turn 3: build-b done
      ],
    };

    const events: ProgressEvent[] = [];
    const result = await withEnv(scenarioEnv(p.root, scenario, "obs1"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 8, review_rounds: 0 }, progress: (e) => events.push(e) }),
    );

    const journal = await readJournalTail(p.root, 200);
    try {
      expect(result.status).toBe("done");

      // ── the journal is the canonical spine ──────────────────────────────────
      const turnEntries = journal.filter((e) => e.kind === "turn");
      expect(turnEntries.map((e) => e.global_turn)).toEqual([1, 2, 3]);
      expect(turnEntries.map((e) => e.task_id)).toEqual(["build-a", "build-b", "build-b"]);

      // ── transcripts: one per turn, named by the journal, ending in driver-meta
      //    whose terminal matches the journal's ─────────────────────────────────
      for (const e of turnEntries) {
        expect(e.transcript).toBe(`.cursor/goal/driver/evidence/turns/${e.global_turn}-${e.task_id}.jsonl`);
        const abs = path.join(p.root, e.transcript!);
        expect(existsSync(abs)).toBe(true);
        const lines = readFileSync(abs, "utf8").split("\n").filter(Boolean);
        const meta = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
        expect(meta.type).toBe("driver-meta");
        expect(meta.terminal).toBe(e.terminal);
      }

      // ── the progress feed tells the same sequence with the same numbers ─────
      const starts = events.filter((e) => e.kind === "turn_start") as Array<{ turn: number; taskId: string }>;
      expect(starts.map((s) => [s.turn, s.taskId])).toEqual([
        [1, "build-a"],
        [2, "build-b"],
        [3, "build-b"],
      ]);
      const ends = events.filter((e) => e.kind === "turn_end") as Array<{ turn: number; decision: string }>;
      expect(ends.map((e) => e.decision)).toEqual(["task_done", "continue_same_session", "task_done"]);
      // and the rendered lines carry the same turn numbers the journal has
      for (const s of starts) {
        expect(formatProgress(s as ProgressEvent)).toContain(`[turn ${s.turn}]`);
      }

      // ── logs retells the journal, filters intact ─────────────────────────────
      const all: string[] = [];
      await runLogs(p.root, {}, (l) => all.push(l.trimEnd()));
      const logTurnLines = all.filter((l) => /\bturn\b/.test(l) && /#\d/.test(l));
      expect(logTurnLines).toHaveLength(3);
      expect(logTurnLines[0]).toMatch(/build-a #1 \[success\]/);
      expect(logTurnLines[2]).toMatch(/build-b #3 \[success\]/);

      const onlyB: string[] = [];
      await runLogs(p.root, { task: "build-b" }, (l) => onlyB.push(l.trimEnd()));
      expect(onlyB.every((l) => /build-b/.test(l))).toBe(true);
      expect(onlyB.filter((l) => /#\d/.test(l))).toHaveLength(2);

      const decisions: string[] = [];
      await runLogs(p.root, { kind: "decision", tail: 1 }, (l) => decisions.push(l.trimEnd()));
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatch(/task_done/);
    } catch (err) {
      // the diagnosability contract: a failing run dumps its full story
      console.error("FULL JOURNAL:\n" + journal.map((e) => JSON.stringify(e)).join("\n"));
      console.error("PROGRESS EVENTS:\n" + events.map((e) => formatProgress(e)).join("\n"));
      throw err;
    }
  });

  it("an escalated run tells the same story across surfaces", async () => {
    const goalMd = "# Goal\n\n## Goal\nFailing goal\n\n## Checks\n\n- `test -f never.txt`\n";
    const p: Project = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f never.txt"], acceptance_prose: "" }] },
      turns: [{ result: "error", delta: "boom" }],
    };
    const events: ProgressEvent[] = [];
    const result = await withEnv(scenarioEnv(p.root, scenario, "obs2"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, task_attempts: 1, review_rounds: 0 }, progress: (e) => events.push(e) }),
    );
    expect(result.status).toBe("escalated");

    const journal = await readJournalTail(p.root, 50);
    const esc = journal.find((e) => e.kind === "escalation");
    expect(esc).toBeDefined();
    const escEvent = events.find((e) => e.kind === "escalation") as { reason: string };
    expect(escEvent.reason).toBe(esc!.note); // same reason on both surfaces

    const logLines: string[] = [];
    await runLogs(p.root, { kind: "escalation" }, (l) => logLines.push(l.trimEnd()));
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toContain(esc!.note!);

    // the failed turn's transcript still exists (teed live despite the error)
    const turnEntry = journal.find((e) => e.kind === "turn");
    expect(existsSync(path.join(p.root, turnEntry!.transcript!))).toBe(true);
  });
});
