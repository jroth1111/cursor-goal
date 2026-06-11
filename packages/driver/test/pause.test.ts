import { afterEach, describe, expect, it } from "vitest";
import { runTurn } from "../src/agent/runner.js";
import { runGoal } from "../src/driver/loop.js";
import { resumeRun } from "../src/driver/resume.js";
import { readJournalTail } from "../src/lib/journal.js";
import { liveLockPid } from "../src/lib/lock.js";
import { loadGraph, loadRun } from "../src/state/store.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(): Project {
  const goalMd = "# Goal\n\n## Goal\nPause test\n\n## Checks\n\n- `test -f done.txt`\n";
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

const plan = {
  tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f done.txt"], acceptance_prose: "" }],
};

describe("operator abort at the runner", () => {
  it("aborting the signal kills a hung child: terminal aborted, abort operator, not a timeout", async () => {
    const p = project();
    const scenario: Scenario = { turns: [{ chaos: { mode: "hang" } }] };
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 200);
    const r = await withEnv(scenarioEnv(p.root, scenario, "pa1"), () =>
      runTurn({ instruction: "go", root: p.root, mode: "edit", signal: ctl.signal }),
    );
    // runTurn resolved => the child's streams closed and it exited: no orphan
    expect(r.terminal).toBe("aborted");
    expect(r.abort).toBe("operator");
    expect(r.timedOut).toBe(false);
  });

  it("watchdog timeout is distinguishable: abort timeout", async () => {
    const p = project();
    const scenario: Scenario = { turns: [{ chaos: { mode: "hang" } }] };
    const r = await withEnv(scenarioEnv(p.root, scenario, "pa2"), () =>
      runTurn({ instruction: "go", root: p.root, mode: "edit", timeoutMs: 400 }),
    );
    expect(r.terminal).toBe("aborted");
    expect(r.abort).toBe("timeout");
    expect(r.timedOut).toBe(true);
  });
});

describe("graceful stop through the loop", () => {
  it("stop mid-turn: partial turn accounted, no attempt charged, state paused, lock released; resume completes", async () => {
    const p = project();
    // Deterministic in-process variant: the injected call plays the part of a
    // turn that the operator interrupts (abort fires while it is "running" and
    // it comes back with abort:"operator", exactly as the real runner does —
    // that real kill behavior is pinned by the runner-level tests above).
    const ctl = new AbortController();
    let turn = 0;
    const { writeFileSync } = await import("node:fs");
    const path = await import("node:path");
    const call = async (opts: { mode?: string }): Promise<import("../src/agent/runner.js").TurnResult> => {
      if (opts.mode === "ask") {
        return { sessionId: "ask", finalText: JSON.stringify(plan), usage: null, terminal: "success", exitCode: 0, timedOut: false };
      }
      turn += 1;
      if (turn === 1) {
        ctl.abort(); // the operator hits Ctrl-C while this turn is in flight
        return {
          sessionId: "s1",
          finalText: "",
          usage: { input_tokens: 5, output_tokens: 7 },
          terminal: "aborted",
          exitCode: null,
          timedOut: false,
          abort: "operator",
        };
      }
      writeFileSync(path.join(p.root, "done.txt"), "x");
      return { sessionId: "s1", finalText: "done", usage: null, terminal: "success", exitCode: 0, timedOut: false };
    };
    const paused = await runGoal({
      root: p.root,
      budgets: { global_turns: 6, review_rounds: 0 },
      stop: ctl.signal,
      call,
    });
    expect(paused.status).toBe("paused");
    expect(paused.global_turns).toBe(1); // the partial turn is counted

    // state persisted and lock released
    expect(await liveLockPid(p.root)).toBeNull();
    const onDisk = (await loadRun(p.root))!;
    expect(onDisk.status).toBe("paused");
    const graph = (await loadGraph(p.root))!;
    expect(graph.tasks[0].attempts).toBe(0); // an operator stop is not the agent's failure

    const journal = await readJournalTail(p.root, 30);
    const aborted = journal.find((e) => e.kind === "turn" && e.terminal === "aborted");
    expect(aborted).toBeDefined();
    expect(aborted!.note).toMatch(/interrupted by operator stop/);
    expect(journal.some((e) => /paused by operator during turn 1/.test(e.note ?? ""))).toBe(true);

    const outcome = await resumeRun(p.root, { call });
    expect(outcome.ok && outcome.run.status).toBe("done");
  });

  it("a turn that COMPLETED before the signal landed is processed, not misrecorded as aborted", async () => {
    const p = project();
    const ctl = new AbortController();
    const { writeFileSync } = await import("node:fs");
    const path = await import("node:path");
    const call = async (opts: { mode?: string }): Promise<import("../src/agent/runner.js").TurnResult> => {
      if (opts.mode === "ask") {
        return { sessionId: "ask", finalText: JSON.stringify(plan), usage: null, terminal: "success", exitCode: 0, timedOut: false };
      }
      // the child finished its work, THEN the operator hit Ctrl-C: success result,
      // no kill — the finished work must count
      writeFileSync(path.join(p.root, "done.txt"), "x");
      ctl.abort();
      return { sessionId: "s1", finalText: "done", usage: null, terminal: "success", exitCode: 0, timedOut: false, abort: null };
    };
    const paused = await runGoal({
      root: p.root,
      budgets: { global_turns: 6, review_rounds: 0 },
      stop: ctl.signal,
      call,
    });
    // the lone task finished, so the gate completes the run — Ctrl-C after the
    // final successful turn must not throw away a done run
    expect(paused.status).toBe("done");
    const journal = await readJournalTail(p.root, 30);
    const turn = journal.find((e) => e.kind === "turn");
    expect(turn!.terminal).toBe("success"); // recorded as what it was
    expect(journal.some((e) => e.kind === "decision" && e.decision === "task_done")).toBe(true);
  });

  it("stop before any turn: pauses immediately, zero turns consumed", async () => {
    const p = project();
    const scenario: Scenario = { plan, turns: [{ mutate: [{ file: "done.txt", content: "x" }] }] };
    const ctl = new AbortController();
    ctl.abort(); // already stopped
    const paused = await withEnv(scenarioEnv(p.root, scenario, "pa4"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 0 }, stop: ctl.signal }),
    );
    expect(paused.status).toBe("paused");
    expect(paused.global_turns).toBe(0);
    const journal = await readJournalTail(p.root, 20);
    expect(journal.some((e) => /paused by operator before a turn started/.test(e.note ?? ""))).toBe(true);
  });
});
