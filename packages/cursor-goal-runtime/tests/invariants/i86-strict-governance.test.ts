import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("I86 strict governance", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;
  const prevStrict = process.env.CURSOR_GOAL_STRICT;
  const prevRuntime = process.env.CURSOR_GOAL_RUNTIME;

  afterEach(async () => {
    if (prevStrict === undefined) delete process.env.CURSOR_GOAL_STRICT;
    else process.env.CURSOR_GOAL_STRICT = prevStrict;
    if (prevRuntime === undefined) delete process.env.CURSOR_GOAL_RUNTIME;
    else process.env.CURSOR_GOAL_RUNTIME = prevRuntime;
    restore?.();
    await cleanup?.();
  });

  it("blocks governed delivery when strict and runtime missing", async () => {
    const p = await mkGitProject("i86");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "governed" }),
      "utf8",
    );
    process.env.CURSOR_GOAL_STRICT = "1";
    delete process.env.CURSOR_GOAL_RUNTIME;

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    const isolatedHome = path.join(os.tmpdir(), `cgr-i86-${process.pid}`);
    mkdirSync(isolatedHome, { recursive: true });
    const env = {
      ...process.env,
      CURSOR_PROJECT_DIR: p.dir,
      CURSOR_GOAL_STRICT: "1",
      HOME: isolatedHome,
    };
    delete env.CURSOR_GOAL_RUNTIME;
    const r = spawnSync(
      "node",
      [hook],
      {
        cwd: p.dir,
        input: JSON.stringify({
          prompt: "implement the feature now",
          conversation_id: "strict-test",
        }),
        encoding: "utf8",
        env,
      },
    );
    const stdout = JSON.parse((r.stdout ?? "").trim() || "{}") as Record<string, unknown>;
    expect(stdout.continue).toBe(false);
    expect(String(stdout.agent_message ?? "")).toMatch(/STRICT/i);
  });
});
