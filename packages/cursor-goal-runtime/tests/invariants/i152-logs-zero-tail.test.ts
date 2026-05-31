import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { appendStopTrace, readStopTraceTail } from "../../src/lib/stop-trace.js";

describe("I152 logs zero tail", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("returns no entries for a zero tail count instead of the whole trace", async () => {
    const p = await mkGitProject("i152-logs-zero");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await appendStopTrace(p.dir, {
      at: "2026-05-31T00:00:00.000Z",
      level_failed: "L3",
      failures: ["first"],
      pipeline_result: "continue",
    });
    await appendStopTrace(p.dir, {
      at: "2026-05-31T00:00:01.000Z",
      level_failed: "L4",
      failures: ["second"],
      pipeline_result: "continue",
    });

    expect(await readStopTraceTail(p.dir, 0)).toEqual([]);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "logs", "0"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });
});
