import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { runGoal } from "../src/driver/loop.js";
import { notifyRunEnd } from "../src/driver/notify.js";
import { readJournalTail } from "../src/lib/journal.js";
import { initRun } from "../src/state/store.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(): Project {
  const goalMd = "# Goal\n\n## Goal\nNotify test\n\n## Checks\n\n- `test -f out.txt`\n";
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

const plan = {
  tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f out.txt"], acceptance_prose: "" }],
};

describe("notify hook", () => {
  it("done run invokes the notifier with the JSON payload on stdin and env vars set", async () => {
    const p = project();
    const scenario: Scenario = { plan, turns: [{ mutate: [{ file: "out.txt", content: "x" }] }] };
    const result = await withEnv(scenarioEnv(p.root, scenario, "nt1"), () =>
      runGoal({
        root: p.root,
        budgets: { global_turns: 4, review_rounds: 0 },
        notify: 'cat > notify-payload.json; printf "%s" "$AGENT_DRIVER_STATUS" > notify-status.txt',
      }),
    );
    expect(result.status).toBe("done");

    const payload = JSON.parse(readFileSync(path.join(p.root, "notify-payload.json"), "utf8"));
    expect(payload).toMatchObject({ status: "done", goal: "Notify test", root: p.root, escalation_reason: null });
    expect(payload.turns).toBeGreaterThan(0);
    expect(readFileSync(path.join(p.root, "notify-status.txt"), "utf8")).toBe("done");

    const journal = await readJournalTail(p.root, 20);
    expect(journal.some((e) => /notify ok/.test(e.note ?? ""))).toBe(true);
  });

  it("escalated run notifies with the reason; GOAL.md Driver notify_cmd is the config home", async () => {
    const goalMd = [
      "# Goal",
      "",
      "## Goal",
      "Escalate and notify",
      "",
      "## Checks",
      "",
      "- `test -f never.txt`",
      "",
      "## Driver",
      "",
      "- notify_cmd: cat > escalation-payload.json",
      "",
    ].join("\n");
    const p = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f never.txt"], acceptance_prose: "" }] },
      turns: [{ result: "error" }],
    };
    const result = await withEnv(scenarioEnv(p.root, scenario, "nt2"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, task_attempts: 1, review_rounds: 0 } }),
    );
    expect(result.status).toBe("escalated");
    const payload = JSON.parse(readFileSync(path.join(p.root, "escalation-payload.json"), "utf8"));
    expect(payload.status).toBe("escalated");
    expect(payload.escalation_reason).toMatch(/attempt budget|failed/);
  });

  it("notifier failures and timeouts are journaled but never affect the outcome", async () => {
    const p = project();
    const run = await initRun({ goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] }, p.root);
    run.status = "done";

    await notifyRunEnd(p.root, run, "exit 1");
    await notifyRunEnd(p.root, run, "sleep 30", 300); // injected tiny timeout
    await notifyRunEnd(p.root, run, undefined); // unset: no-op
    await notifyRunEnd(p.root, run, "  "); // blank: no-op

    const journal = await readJournalTail(p.root, 20);
    const notes = journal.map((e) => e.note ?? "");
    expect(notes.some((n) => /notify failed: exit 1/.test(n))).toBe(true);
    expect(notes.some((n) => /notify timed out after 300ms/.test(n))).toBe(true);
    expect(notes.filter((n) => /notify/.test(n))).toHaveLength(2); // no-ops journal nothing
  });

  it("a run without any notify config journals nothing about notify", async () => {
    const p = project();
    const scenario: Scenario = { plan, turns: [{ mutate: [{ file: "out.txt", content: "x" }] }] };
    const result = await withEnv(scenarioEnv(p.root, scenario, "nt3"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");
    expect(existsSync(path.join(p.root, "notify-payload.json"))).toBe(false);
    const journal = await readJournalTail(p.root, 30);
    expect(journal.some((e) => /notify/.test(e.note ?? ""))).toBe(false);
  });
});
