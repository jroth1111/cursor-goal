import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runTurn } from "../src/agent/runner.js";
import { runGoal } from "../src/driver/loop.js";
import { readJournalTail } from "../src/lib/journal.js";
import { loadContext } from "../src/driver/context-window.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(check: string): Project {
  const goalMd = `# Goal\n\n## Goal\nDrift test\n\n## Checks\n\n- \`${check}\`\n`;
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

async function turn(p: Project, scenario: Scenario, tag: string, timeoutMs?: number) {
  return withEnv(scenarioEnv(p.root, scenario, tag), () =>
    runTurn({ instruction: "go", root: p.root, mode: "edit", timeoutMs }),
  );
}

describe("anomaly classification at the runner", () => {
  it("exit 0 with no result event is drift, with a raw sample", async () => {
    const p = project("true");
    const r = await turn(p, { turns: [{ chaos: { mode: "no-result-event" } }] }, "dr1");
    expect(r.anomaly?.kind).toBe("no-result-event");
    expect(r.anomaly?.detail).toMatch(/exited 0/);
    expect(r.anomaly?.detail).toMatch(/system×1/); // observed event shapes named
    expect(r.rawSample?.some((l) => l.includes('"type":"system"'))).toBe(true);
  });

  it("a successful result without any session_id is the resume-impossible drift class", async () => {
    const p = project("true");
    const r = await turn(p, { turns: [{ chaos: { mode: "no-session-id" } }] }, "dr2");
    expect(r.terminal).toBe("success"); // honest work is not failed
    expect(r.anomaly?.kind).toBe("missing-session-id");
  });

  it("controls: a mid-stream crash, garbage lines, timeouts, and clean turns are NOT drift", async () => {
    const p = project("true");
    const crash = await turn(p, { turns: [{ chaos: { mode: "crash-mid-stream" } }] }, "dr3");
    expect(crash.terminal).toBe("error");
    expect(crash.anomaly).toBeNull();

    const garbage = await turn(p, { turns: [{ chaos: { mode: "garbage-lines" }, delta: "fine" }] }, "dr4");
    expect(garbage.terminal).toBe("success");
    expect(garbage.anomaly).toBeNull();

    const hung = await turn(p, { turns: [{ chaos: { mode: "hang" } }] }, "dr5", 400);
    expect(hung.abort).toBe("timeout");
    expect(hung.anomaly).toBeNull(); // a watchdog kill is not drift

    const clean = await turn(p, { turns: [{ delta: "ok" }] }, "dr6");
    expect(clean.anomaly).toBeNull();
  });
});

describe("drift through the loop", () => {
  it("a no-result drift turn gets a CONTRACT-DRIFT failure artifact, journal note, and probe pointer", async () => {
    const p = project("test -f made.txt");
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
      turns: [
        { chaos: { mode: "no-result-event" } }, // drift turn
        { mutate: [{ file: "made.txt", content: "x" }] }, // recovery
      ],
    };
    const result = await withEnv(scenarioEnv(p.root, scenario, "drl1"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");

    const journal = await readJournalTail(p.root, 50);
    const note = journal.find((e) => /CONTRACT-DRIFT suspected/.test(e.note ?? ""));
    expect(note).toBeDefined();
    expect(note!.note).toMatch(/no result event/);

    // the failure fed forward names drift, shows the raw stream, and points at the probe
    const ctx = await loadContext(p.root, "t1");
    expect(ctx.last_failure).toMatch(/^CONTRACT-DRIFT:/);
    expect(ctx.last_failure).toMatch(/raw stream sample/);
    expect(ctx.last_failure).toMatch(/doctor --probe/);
    const artifact = readFileSync(path.join(p.root, ctx.last_failure_artifact), "utf8");
    expect(artifact).toMatch(/CONTRACT-DRIFT/);
  });

  it("missing-session-id on a SUCCESSFUL turn journals the suspicion without failing the task", async () => {
    const p = project("test -f made.txt");
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
      turns: [{ mutate: [{ file: "made.txt", content: "x" }], chaos: { mode: "no-session-id" } }],
    };
    // chaos no-session-id doesn't mutate; mutations apply before chaos — confirmed by harness self-test
    const result = await withEnv(scenarioEnv(p.root, scenario, "drl2"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 4, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done"); // honest work shipped
    const journal = await readJournalTail(p.root, 50);
    const note = journal.find((e) => /CONTRACT-DRIFT suspected/.test(e.note ?? ""));
    expect(note).toBeDefined();
    expect(note!.note).toMatch(/session_id/);
    expect(note!.note).toMatch(/doctor --probe/);
  });

  it("plain agent errors keep their ordinary failure text (no drift labeling)", async () => {
    const p = project("test -f made.txt");
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
      turns: [{ result: "error", delta: "the agent broke" }, { mutate: [{ file: "made.txt", content: "x" }] }],
    };
    const result = await withEnv(scenarioEnv(p.root, scenario, "drl3"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");
    const journal = await readJournalTail(p.root, 50);
    expect(journal.some((e) => /CONTRACT-DRIFT/.test(e.note ?? ""))).toBe(false);
    const ctx = await loadContext(p.root, "t1");
    expect(ctx.last_failure).not.toMatch(/CONTRACT-DRIFT/);
  });
});
