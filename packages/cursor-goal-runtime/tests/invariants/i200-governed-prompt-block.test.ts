import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I200 governed_prompt_block", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("blocks governed prompt when GOAL missing and flag set", async () => {
    const p = await mkGitProject("i200");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "governed", governed_prompt_block: true }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/session-mode.json"),
      JSON.stringify({ mode: "governed", source: "cli", updated_at: new Date().toISOString() }),
      "utf8",
    );
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ prompt: "/goal implement the feature fully" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as {
      continue?: boolean;
    };
    expect(out.continue).toBe(false);
  }, 15000);
});
