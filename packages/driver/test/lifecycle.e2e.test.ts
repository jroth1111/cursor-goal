import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TurnResult } from "../src/agent/runner.js";
import { runGoal } from "../src/driver/loop.js";
import { resetRun } from "../src/driver/reset.js";
import { resumeRun } from "../src/driver/resume.js";
import { steerTask } from "../src/driver/steer.js";
import { readJournalTail } from "../src/lib/journal.js";
import { liveLockPid } from "../src/lib/lock.js";
import { escalationPath } from "../src/lib/paths.js";
import { loadGraph, loadRun, saveGraph } from "../src/state/store.js";
import { mkGitProject, type Project } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/**
 * The whole operator story in one walk:
 *   run → SIGINT pause → resume → escalate → edit graph + steer → resume → done
 *   → reset → second fresh run.
 * Every transition asserted from on-disk state and the journal. The lifecycle
 * verbs interact (resume-after-pause vs after-escalation, reset under archives,
 * recovery on re-entry) — only an end-to-end walk catches bad interactions
 * between independently-tested pieces. Each phase logs a banner so a hang is
 * attributable; the journal prints on failure.
 */
describe("lifecycle end-to-end", () => {
  it("pause → resume → escalate → steer → resume → done → reset → fresh run", async () => {
    const goalMd = "# Goal\n\n## Goal\nLifecycle goal\n\n## Checks\n\n- `test -f deliverable.txt`\n";
    const p: Project = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);
    const banner = (s: string) => process.stdout.write(`── lifecycle phase: ${s}\n`);

    const plan = {
      tasks: [
        { id: "t1", title: "deliver", kind: "implement", deps: [], acceptance_checks: ["test -f deliverable.txt"], acceptance_prose: "" },
      ],
    };
    const stopCtl = new AbortController();
    let turn = 0;
    const mkResult = (over: Partial<TurnResult>): TurnResult => ({
      sessionId: "sess",
      finalText: "",
      usage: { input_tokens: 3, output_tokens: 4 },
      terminal: "success",
      exitCode: 0,
      timedOut: false,
      ...over,
    });
    const call = async (opts: { mode?: string; instruction: string }): Promise<TurnResult> => {
      if (opts.mode === "ask") return mkResult({ finalText: JSON.stringify(plan) });
      turn += 1;
      switch (turn) {
        case 1: // operator hits Ctrl-C while this turn runs
          stopCtl.abort();
          return mkResult({ terminal: "aborted", abort: "operator" });
        case 2: // post-resume work fails…
        case 3: // …twice: attempt budget (2) exhausted -> escalate
          return mkResult({ terminal: "error", exitCode: 1, finalText: "cannot find the spec" });
        default: {
          // post-steer turn only succeeds if the guidance reached the prompt
          // (the fresh post-reset run, turn>=101, has no guidance by design)
          if (turn < 100 && !opts.instruction.includes("the spec lives in docs/spec.md")) {
            return mkResult({ terminal: "error", exitCode: 1, finalText: "still lost" });
          }
          writeFileSync(path.join(p.root, "deliverable.txt"), "done");
          return mkResult({ finalText: "delivered" });
        }
      }
    };
    const budgets = { global_turns: 12, task_attempts: 2, review_rounds: 0 };

    const journalOnFail = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        const journal = await readJournalTail(p.root, 200);
        console.error("FULL JOURNAL:\n" + journal.map((e) => JSON.stringify(e)).join("\n"));
        throw err;
      }
    };

    await journalOnFail(async () => {
      banner("run → SIGINT pause");
      const paused = await runGoal({ root: p.root, budgets, call, stop: stopCtl.signal });
      expect(paused.status).toBe("paused");
      expect(paused.global_turns).toBe(1);
      expect(await liveLockPid(p.root)).toBeNull(); // lock released

      banner("resume → escalate");
      const escalated = await resumeRun(p.root, { call });
      expect(escalated.ok && escalated.run.status).toBe("escalated");
      expect(existsSync(escalationPath(p.root))).toBe(true);
      expect(existsSync(escalationPath(p.root).replace(/\.json$/, ".md"))).toBe(true);

      banner("operator: edit graph + steer");
      const graph = (await loadGraph(p.root))!;
      graph.tasks[0].title = "deliver (operator clarified)"; // a legitimate hand edit
      await saveGraph(p.root, graph);
      const steered = await steerTask(p.root, "t1", "the spec lives in docs/spec.md");
      expect(steered.ok).toBe(true);

      banner("resume → done");
      const done = await resumeRun(p.root, { call });
      expect(done.ok && done.run.status).toBe("done");
      expect(existsSync(escalationPath(p.root))).toBe(false);
      expect(existsSync(path.join(p.root, "deliverable.txt"))).toBe(true);

      const journal = await readJournalTail(p.root, 200);
      const notes = journal.map((e) => e.note ?? "");
      expect(notes.some((n) => /paused by operator/.test(n))).toBe(true);
      expect(notes.some((n) => /resumed from pause/.test(n))).toBe(true);
      expect(notes.some((n) => /resumed from escalation/.test(n))).toBe(true);
      expect(notes.some((n) => /operator steer/.test(n))).toBe(true);
      expect(notes.some((n) => /goal acceptance checks pass/.test(n))).toBe(true);

      banner("reset → fresh second run");
      const reset = await resetRun(p.root);
      expect(reset.ok).toBe(true);
      expect(await loadRun(p.root)).toBeNull();
      expect(readdirSync(reset.archiveDir!)).toContain("journal.jsonl");

      // a brand-new goal starts from zero on the same repo
      turn = 100; // the injected call's default branch now succeeds immediately
      const second = await runGoal({ root: p.root, budgets, call });
      expect(second.status).toBe("done");
      expect(second.global_turns).toBe(1); // fresh accounting, not a continuation
    });
  });
});
