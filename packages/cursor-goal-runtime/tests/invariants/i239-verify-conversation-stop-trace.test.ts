import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { readStopTraceTail } from "../../src/lib/stop-trace.js";

describe("I239 verify --conversation records agent in stop trace", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("CLI verify --conversation tags stop-trace agent_id", async () => {
    const p = await mkGitProject("i239-trace");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const agentId = "conv-trace-agent";
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nlong enough goal text\n## Checks\n- `true`\n",
      "utf8",
    );
    await seedReleaseReady(p.dir);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "verify", "--conversation", agentId], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);

    const tail = await readStopTraceTail(p.dir, 5);
    const match = tail.find((e) => e.agent_id === agentId);
    expect(match).toBeDefined();
    expect(match?.pipeline_result).toBe("release");
  });
});
