import { afterEach, describe, expect, it } from "vitest";
import { runTurn } from "../src/agent/runner.js";
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

/** One edit-mode turn against the stub with the given scenario. */
async function turn(p: Project, scenario: Scenario, timeoutMs?: number) {
  return withEnv(scenarioEnv(p.root, scenario, "chaos"), () =>
    runTurn({ instruction: "do the thing", root: p.root, mode: "edit", timeoutMs }),
  );
}

// Self-test: each chaos mode emits what it claims, as observed through the real
// runner/stream parser — the same lens the driver uses.
describe("chaos-mode fake-agent harness", () => {
  it("crash-mid-stream: partial NDJSON then nonzero exit is a plain error, session still captured", async () => {
    const p = project();
    const r = await turn(p, { turns: [{ chaos: { mode: "crash-mid-stream", afterLines: 2 } }] });
    expect(r.terminal).toBe("error");
    expect(r.exitCode).toBe(1);
    expect(r.sessionId).toBe("edit-sess-0"); // init line was emitted before the crash
  });

  it("garbage-lines: non-JSON lines are skipped and the turn still succeeds", async () => {
    const p = project();
    const r = await turn(p, { turns: [{ chaos: { mode: "garbage-lines" }, delta: "ok despite noise" }] });
    expect(r.terminal).toBe("success");
    expect(r.finalText).toBe("ok despite noise");
  });

  it("no-session-id: well-formed result without session_id yields success with null session", async () => {
    const p = project();
    const r = await turn(p, { turns: [{ chaos: { mode: "no-session-id" }, delta: "anon" }] });
    expect(r.terminal).toBe("success");
    expect(r.sessionId).toBeNull();
    expect(r.finalText).toBe("anon");
  });

  it("no-result-event: exit 0 with no result event is currently classified aborted (the drift signature)", async () => {
    const p = project();
    const r = await turn(p, { turns: [{ chaos: { mode: "no-result-event" } }] });
    expect(r.terminal).toBe("aborted");
    expect(r.exitCode).toBe(0);
    expect(r.sessionId).toBe("edit-sess-0");
  });

  it("hang: stays alive until the runner's timeout kills it", async () => {
    const p = project();
    const r = await turn(p, { turns: [{ chaos: { mode: "hang" } }] }, 700);
    expect(r.timedOut).toBe(true);
    expect(r.terminal).toBe("aborted");
  });

  it("slow-drip: delayed line-by-line emission still parses to a normal success", async () => {
    const p = project();
    const r = await turn(p, { turns: [{ chaos: { mode: "slow-drip", lineDelayMs: 20 }, delta: "dripped" }] });
    expect(r.terminal).toBe("success");
    expect(r.finalText).toBe("dripped");
    expect(r.usage?.output_tokens).toBe(20);
  });

  it("chaos turns still apply mutations first (a turn can edit files and then misbehave)", async () => {
    const p = project();
    const r = await turn(p, {
      turns: [{ mutate: [{ file: "made.txt", content: "x" }], chaos: { mode: "crash-mid-stream" } }],
    });
    expect(r.terminal).toBe("error");
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");
    expect(existsSync(path.join(p.root, "made.txt"))).toBe(true);
  });

  it("bad-schema pattern: a wrong-schema verdict object is served verbatim through ask mode", async () => {
    const p = project();
    const badVerdict = { totally: "not a verdict" };
    const r = await withEnv(scenarioEnv(p.root, { verdicts: [badVerdict] }, "chaos-ask"), () =>
      runTurn({ instruction: "judge the task evidence", root: p.root, mode: "ask" }),
    );
    expect(r.terminal).toBe("success");
    expect(JSON.parse(r.finalText)).toEqual(badVerdict);
  });
});
