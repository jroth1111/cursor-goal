import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { runTurn } from "../src/agent/runner.js";
import { runGoal } from "../src/driver/loop.js";
import { readJournalTail } from "../src/lib/journal.js";
import { loadGraph } from "../src/state/store.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(): Project {
  const p = mkGitProject();
  cleanups.push(p.cleanup);
  return p;
}

function lines(file: string): string[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean);
}

function lastMeta(file: string): Record<string, unknown> {
  const all = lines(file);
  const meta = JSON.parse(all[all.length - 1]) as Record<string, unknown>;
  expect(meta.type).toBe("driver-meta");
  return meta;
}

describe("turn transcripts (runner tee)", () => {
  it("captures exactly the emitted NDJSON plus a driver-meta trailer", async () => {
    const p = project();
    const file = path.join(p.root, "t.jsonl");
    const scenario: Scenario = { turns: [{ delta: "hello transcript" }] };
    const r = await withEnv(scenarioEnv(p.root, scenario, "tr1"), () =>
      runTurn({ instruction: "go", root: p.root, mode: "edit", transcriptPath: file }),
    );
    expect(r.terminal).toBe("success");
    const all = lines(file);
    // stub emits exactly: system init, assistant, result — then our trailer
    expect(all).toHaveLength(4);
    expect(JSON.parse(all[0])).toMatchObject({ type: "system", subtype: "init" });
    expect(JSON.parse(all[1])).toMatchObject({ type: "assistant", text: "hello transcript" });
    expect(JSON.parse(all[2])).toMatchObject({ type: "result", result: "hello transcript" });
    expect(lastMeta(file)).toMatchObject({ terminal: "success", exit_code: 0, timed_out: false });
    expect(typeof lastMeta(file).elapsed_ms).toBe("number");
  });

  it("a turn that crashes mid-stream still leaves its partial transcript", async () => {
    const p = project();
    const file = path.join(p.root, "crash.jsonl");
    const scenario: Scenario = { turns: [{ chaos: { mode: "crash-mid-stream", afterLines: 2 } }] };
    const r = await withEnv(scenarioEnv(p.root, scenario, "tr2"), () =>
      runTurn({ instruction: "go", root: p.root, mode: "edit", transcriptPath: file }),
    );
    expect(r.terminal).toBe("error");
    const all = lines(file);
    expect(all).toHaveLength(3); // two partial events + trailer, no result line
    expect(all.some((l) => l.includes('"type":"result"'))).toBe(false);
    expect(lastMeta(file)).toMatchObject({ terminal: "error", exit_code: 1 });
  });

  it("stderr lines are wrapped as {type:'stderr'} entries", async () => {
    const p = project();
    const file = path.join(p.root, "err.jsonl");
    // unknown chaos mode makes the stub print to stderr and exit 3
    const scenario = { turns: [{ chaos: { mode: "not-a-mode" } }] } as unknown as Scenario;
    const r = await withEnv(scenarioEnv(p.root, scenario, "tr3"), () =>
      runTurn({ instruction: "go", root: p.root, mode: "edit", transcriptPath: file }),
    );
    expect(r.exitCode).toBe(3);
    const stderrLines = lines(file)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.type === "stderr");
    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0].line).toMatch(/unknown chaos mode not-a-mode/);
    expect(lastMeta(file)).toMatchObject({ exit_code: 3 });
  });

  it("no transcriptPath -> no file, identical behavior", async () => {
    const p = project();
    const scenario: Scenario = { turns: [{ delta: "plain" }] };
    const r = await withEnv(scenarioEnv(p.root, scenario, "tr4"), () =>
      runTurn({ instruction: "go", root: p.root, mode: "edit" }),
    );
    expect(r.terminal).toBe("success");
    expect(readdirSync(p.root).filter((f) => f.endsWith(".jsonl"))).toEqual([]);
  });
});

describe("retry transcripts", () => {
  it("each decompose retry writes its own transcript — malformed attempts are the evidence", async () => {
    const p = project();
    const { decompose } = await import("../src/driver/decompose.js");
    const seenPaths: Array<string | undefined> = [];
    let attempt = 0;
    const call = async (opts: { transcriptPath?: string }) => {
      seenPaths.push(opts.transcriptPath);
      attempt += 1;
      const text =
        attempt === 1
          ? "this is not a task graph"
          : JSON.stringify({ tasks: [{ id: "t1", title: "t", kind: "implement", deps: [], acceptance_checks: ["true"], acceptance_prose: "" }] });
      return { sessionId: "s", finalText: text, usage: null, terminal: "success" as const, exitCode: 0, timedOut: false };
    };
    const base = path.join(p.root, "evidence-turns", "decompose.jsonl");
    const dec = await decompose(
      { goal_text: "g", source: "prompt", acceptance_checks: ["true"], non_goals: [], scope: [] },
      p.root,
      call,
      base,
    );
    expect(dec.source).toBe("planner");
    expect(seenPaths).toEqual([base, base.replace(/\.jsonl$/, ".retry1.jsonl")]);
  });
});

describe("transcripts through the loop", () => {
  it("every turn leaves evidence/turns/<n>-<task>.jsonl, referenced by journal and proof_ptrs", async () => {
    const goalMd = "# Goal\n\n## Goal\nTranscribed\n\n## Checks\n\n- `test -f made.txt`\n";
    const p = mkGitProject({ "GOAL.md": goalMd });
    cleanups.push(p.cleanup);
    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
      verdicts: [{ task_complete: false, confidence: 0.4, blockers: [], next_action: { kind: "continue", instruction: "make the file" } }],
      turns: [
        { delta: "first try, no file" }, // checks fail -> verdict consulted
        { mutate: [{ file: "made.txt", content: "x" }] },
      ],
    };
    const result = await withEnv(scenarioEnv(p.root, scenario, "trl"), () =>
      runGoal({ root: p.root, budgets: { global_turns: 6, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");

    const turnsDir = path.join(p.root, ".cursor", "goal", "driver", "evidence", "turns");
    const files = readdirSync(turnsDir).sort();
    expect(files).toContain("1-t1.jsonl");
    expect(files).toContain("2-t1.jsonl");
    expect(files).toContain("decompose.jsonl"); // brain calls leave transcripts too
    expect(files).toContain("verdict-1.jsonl");

    // journal turn entries reference their transcript
    const journal = await readJournalTail(p.root, 50);
    const turnEntries = journal.filter((e) => e.kind === "turn");
    expect(turnEntries.length).toBeGreaterThanOrEqual(2);
    for (const e of turnEntries) {
      expect(e.transcript).toMatch(/^\.cursor\/goal\/driver\/evidence\/turns\/\d+-t1\.jsonl$/);
      expect(existsSync(path.join(p.root, e.transcript!))).toBe(true);
    }

    // task evidence points at the transcripts
    const graph = await loadGraph(p.root);
    const ptrs = graph!.tasks[0].evidence.proof_ptrs;
    expect(ptrs).toContain(".cursor/goal/driver/evidence/turns/1-t1.jsonl");
    expect(ptrs).toContain(".cursor/goal/driver/evidence/turns/2-t1.jsonl");

    // each transcript is complete: ends with driver-meta
    expect(lastMeta(path.join(turnsDir, "1-t1.jsonl"))).toMatchObject({ terminal: "success" });
  });
});
