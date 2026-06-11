import { afterEach, describe, expect, it } from "vitest";
import { formatProbe, probeContract } from "../src/driver/probe.js";
import type { TurnResult } from "../src/agent/runner.js";
import { mkGitProject, scenarioEnv, withEnv, type Project } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(): Project {
  const p = mkGitProject();
  cleanups.push(p.cleanup);
  return p;
}

function turnResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    sessionId: "sess-1",
    finalText: "ok",
    usage: { input_tokens: 10, output_tokens: 2 },
    terminal: "success",
    exitCode: 0,
    timedOut: false,
    abort: null,
    anomaly: null,
    ...overrides,
  };
}

describe("doctor --probe", () => {
  it("passes end-to-end against the (healthy) stub, resume round-trip included", async () => {
    const p = project();
    const result = await withEnv(scenarioEnv(p.root, {}, "pb1"), () => probeContract(p.root));
    expect(result.checks.map((c) => `${c.name}:${c.ok}`)).toEqual([
      "turn completes:true",
      "session_id captured:true",
      "result event well-formed:true",
      "usage parsed:true",
      "--resume round-trips:true",
    ]);
    expect(result.ok).toBe(true);
    expect(formatProbe(result)).toMatch(/contract probe: OK/);
  });

  it("each failure class reports specifically", async () => {
    const p = project();

    // spawn-level failure
    const spawnFail = await probeContract(p.root, () => Promise.reject(new Error("ENOENT: no such binary")));
    expect(spawnFail.ok).toBe(false);
    expect(spawnFail.checks[0]).toMatchObject({ name: "turn completes", ok: false });
    expect(spawnFail.checks[0].detail).toMatch(/ENOENT/);

    // missing session_id
    const noSession = await probeContract(p.root, async () =>
      turnResult({ sessionId: null, anomaly: { kind: "missing-session-id", detail: "no event carried a session_id" } }),
    );
    expect(noSession.ok).toBe(false);
    const bySess = Object.fromEntries(noSession.checks.map((c) => [c.name, c]));
    expect(bySess["session_id captured"].ok).toBe(false);
    expect(bySess["result event well-formed"].ok).toBe(false);
    expect(bySess["--resume round-trips"].ok).toBe(false);
    expect(bySess["--resume round-trips"].detail).toMatch(/skipped/);

    // anomaly with observed event shapes in the detail
    const drifted = await probeContract(p.root, async () =>
      turnResult({
        terminal: "aborted",
        anomaly: { kind: "no-result-event", detail: "exited 0 but no result event (types: system×1, assistant×2)" },
      }),
    );
    expect(drifted.ok).toBe(false);
    expect(formatProbe(drifted)).toMatch(/types: system×1, assistant×2/);

    // no usage
    const noUsage = await probeContract(p.root, async () => turnResult({ usage: null }));
    expect(Object.fromEntries(noUsage.checks.map((c) => [c.name, c.ok]))["usage parsed"]).toBe(false);

    // resume returns a different session
    let call = 0;
    const badResume = await probeContract(p.root, async () => {
      call += 1;
      return call === 1 ? turnResult() : turnResult({ sessionId: "different-session" });
    });
    const resumeCheck = badResume.checks.find((c) => c.name === "--resume round-trips")!;
    expect(resumeCheck.ok).toBe(false);
    expect(resumeCheck.detail).toMatch(/expected session sess-1, got different-session/);
  });

  it("the probe goes through the real runner code path (resume flag honored by the stub)", async () => {
    const p = project();
    // the stub echoes --resume as the session, so a successful round-trip proves
    // the second call actually carried the first session id
    const result = await withEnv(scenarioEnv(p.root, {}, "pb2"), () => probeContract(p.root));
    const resume = result.checks.find((c) => c.name === "--resume round-trips")!;
    expect(resume.ok).toBe(true);
    expect(resume.detail).toMatch(/same session/);
  });
});
