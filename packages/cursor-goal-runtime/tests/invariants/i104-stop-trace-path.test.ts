import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendStopTrace, readStopTraceTail } from "../../src/lib/stop-trace.js";

describe("I104 stop-trace path creation", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("creates .cursor/goal before appending stop trace entries", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "i104-stop-trace-"));

    await appendStopTrace(dir, {
      at: "2026-05-31T00:00:00.000Z",
      level_failed: "L3",
      failures: ["npm test"],
      pipeline_result: "continue",
    });

    const entries = await readStopTraceTail(dir, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0].pipeline_result).toBe("continue");
    expect(entries[0].failures).toContain("npm test");
  });
});
