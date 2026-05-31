import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I169 subagentStop malformed work-unit state", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  it("returns fail-open JSON instead of crashing on malformed work-units.json", async () => {
    const p = await mkGitProject("i169-subagent-stop-malformed");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(path.join(p.dir, ".cursor/goal/work-units.json"), "{", "utf8");

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-subagentStop.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        subagent_id: "agent-a",
        work_unit_id: "unit-a",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as {
      agent_message?: string;
    };
    expect(out.agent_message).toMatch(/subagentStop warning|continuing fail-open/i);
  });
});
