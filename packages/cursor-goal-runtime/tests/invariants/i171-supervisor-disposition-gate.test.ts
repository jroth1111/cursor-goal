import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I171 supervisor disposition gate", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("refuses to launch when a per-agent disposition is active without the legacy manifest", async () => {
    const p = await mkGitProject("i171-supervisor-agent-disposition");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await mkdir(path.join(p.dir, ".cursor/hooks"), { recursive: true });
    await writeFile(path.join(p.dir, ".cursor/hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
    const agentDisposition = path.join(p.dir, ".cursor/goal/agents/agent-a/DISPOSITION.json");
    await mkdir(path.dirname(agentDisposition), { recursive: true });
    await writeFile(
      agentDisposition,
      JSON.stringify({
        status: "DISPOSITION",
        recoverable: true,
        failed: ["budget"],
        loop_count: 40,
        agent_id: "agent-a",
        at: new Date().toISOString(),
      }),
      "utf8",
    );

    const supervisor = path.resolve(import.meta.dirname, "../../../../supervisor/run-goal.mjs");
    const r = spawnSync("node", [supervisor, "--dry-run"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).toBe(2);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/agents\/agent-a\/DISPOSITION\.json/);
  });
});
