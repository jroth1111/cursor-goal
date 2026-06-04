import { describe, it, expect, afterEach } from "vitest";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { appendStopTrace, readStopTraceTail, sumTokenUsage, type StopTraceEntry } from "../../src/lib/stop-trace.js";

describe("I212 stop trace includes token fields when provided", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("includes token_usage when provided to appendStopTrace", async () => {
    const p = await mkGitProject("i212-token-fields");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await appendStopTrace(p.dir, {
      at: new Date().toISOString(),
      level_failed: "L3",
      failures: ["npm test"],
      pipeline_result: "continue",
      token_usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 200,
        cache_write_tokens: 100,
      },
    });

    const tail = await readStopTraceTail(p.dir, 1);
    expect(tail).toHaveLength(1);
    expect(tail[0].token_usage).toEqual({
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 200,
      cache_write_tokens: 100,
    });
  });

  it("gracefully omits token_usage when not provided", async () => {
    const p = await mkGitProject("i212-no-tokens");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await appendStopTrace(p.dir, {
      at: new Date().toISOString(),
      level_failed: null,
      failures: [],
      pipeline_result: "release",
    });

    const tail = await readStopTraceTail(p.dir, 1);
    expect(tail).toHaveLength(1);
    expect(tail[0].token_usage).toBeUndefined();
  });

  it("sumTokenUsage aggregates across entries", async () => {
    const entries: StopTraceEntry[] = [
      { at: "t1", level_failed: null, failures: [], pipeline_result: "continue", token_usage: { input_tokens: 100, output_tokens: 50 } },
      { at: "t2", level_failed: null, failures: [], pipeline_result: "continue", token_usage: { input_tokens: 200, output_tokens: 75, cache_read_tokens: 50 } },
      { at: "t3", level_failed: null, failures: [], pipeline_result: "release" },
    ];
    const sum = sumTokenUsage(entries);
    expect(sum.input).toBe(300);
    expect(sum.output).toBe(125);
    expect(sum.cache_read).toBe(50);
    expect(sum.cache_write).toBe(0);
  });
});
