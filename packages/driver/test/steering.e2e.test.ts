import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TurnResult } from "../src/agent/runner.js";
import { runGoal } from "../src/driver/loop.js";
import { resumeRun } from "../src/driver/resume.js";
import { steerTask } from "../src/driver/steer.js";
import { readJournalTail } from "../src/lib/journal.js";
import { escalationPath } from "../src/lib/paths.js";
import { mkGitProject, type Project } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/**
 * The intended operator workflow as an executable document: escalation produces
 * a handoff that names the steer command; steering changes what the agent is
 * told (the agent here only succeeds when the instruction carries the guidance —
 * a precise assertion that steering reaches the prompt); resume drives to done.
 * Also pins the rank-ordering rule: OPERATOR GUIDANCE above model steering,
 * below acceptance.
 */
describe("steering end-to-end", () => {
  it("escalate → handoff names steer → steer → resume → guidance leads the prompt → done", async () => {
    const goalMd = "# Goal\n\n## Goal\nSteering e2e goal\n\n## Checks\n\n- `test -f answer.txt`\n";
    const p: Project = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);

    const GUIDANCE = "the answer is 42, write it to answer.txt";
    const plan = {
      tasks: [
        { id: "solve", title: "find the answer", kind: "implement", deps: [], acceptance_checks: ["test -f answer.txt"], acceptance_prose: "" },
      ],
    };
    const instructions: string[] = [];
    const mk = (over: Partial<TurnResult>): TurnResult => ({
      sessionId: "s",
      finalText: "",
      usage: null,
      terminal: "success",
      exitCode: 0,
      timedOut: false,
      ...over,
    });
    const call = async (opts: { mode?: string; instruction: string }): Promise<TurnResult> => {
      if (opts.mode === "ask") return mk({ finalText: JSON.stringify(plan) });
      instructions.push(opts.instruction);
      // the agent is lost until the human's one-liner reaches its prompt
      if (!opts.instruction.includes(GUIDANCE)) {
        return mk({ terminal: "error", exitCode: 1, finalText: "no idea what the answer is" });
      }
      writeFileSync(path.join(p.root, "answer.txt"), "42");
      return mk({ finalText: "answered" });
    };
    const budgets = { global_turns: 10, task_attempts: 2, review_rounds: 0 };

    const journalOnFail = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        const journal = await readJournalTail(p.root, 200);
        console.error("FULL JOURNAL:\n" + journal.map((e) => JSON.stringify(e)).join("\n"));
        console.error("INSTRUCTIONS:\n" + instructions.join("\n────\n"));
        throw err;
      }
    };

    await journalOnFail(async () => {
      // phase 1: the run escalates without help
      const first = await runGoal({ root: p.root, budgets, call });
      expect(first.status).toBe("escalated");

      // phase 2: the handoff document advertises exactly what to type next
      const md = readFileSync(escalationPath(p.root).replace(/\.json$/, ".md"), "utf8");
      expect(md).toMatch(/agent-driver steer solve "your one-line guidance"/);
      expect(md).toMatch(/agent-driver resume/);
      expect(md).toMatch(/no idea what the answer is/); // the failure the human must answer

      // phase 3: the human answers in one line
      const steered = await steerTask(p.root, "solve", GUIDANCE);
      expect(steered.ok).toBe(true);

      // phase 4: resume → the guidance leads the next instruction → done
      const done = await resumeRun(p.root, { call });
      expect(done.ok && done.run.status).toBe("done");

      const steeredInstruction = instructions[instructions.length - 1];
      expect(steeredInstruction).toContain("OPERATOR GUIDANCE");
      expect(steeredInstruction).toContain(GUIDANCE);
      // rank order: contract (acceptance) above guidance, guidance above history
      const acceptanceAt = steeredInstruction.indexOf("commands exit 0");
      const guidanceAt = steeredInstruction.indexOf("OPERATOR GUIDANCE");
      const historyAt = steeredInstruction.indexOf("What has already been tried");
      expect(acceptanceAt).toBeGreaterThan(-1);
      expect(guidanceAt).toBeGreaterThan(acceptanceAt);
      expect(historyAt).toBeGreaterThan(guidanceAt);

      // pre-steer instructions never contained guidance (it really came from steer)
      for (const i of instructions.slice(0, -1)) {
        expect(i).not.toContain("OPERATOR GUIDANCE");
      }
      expect(existsSync(escalationPath(p.root))).toBe(false);
    });
  });
});
