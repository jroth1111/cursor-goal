import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I35 hooks do not inject Task prompts", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seedOpenUnits(p: { dir: string }): Promise<void> {
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await runStopVerifier({ status: "completed", loop_count: 0 });
  }

  it("beforeSubmitPrompt does not inject Task prompt", async () => {
    const p = await mkGitProject("i35");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedOpenUnits(p);

    const hookPath = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    const r = spawnSync("node", [hookPath], {
      cwd: p.dir,
      input: "{}",
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(out.continue).toBe(true);
    expect(String(out.user_message ?? out.agent_message ?? "")).not.toMatch(/Spawn a Task/);
    expect(String(out.user_message ?? out.agent_message ?? "")).not.toMatch(/work_unit_id: mod-a/);
  });

  it("sessionStart does not inject Task prompt", async () => {
    const p = await mkGitProject("i35b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedOpenUnits(p);

    const hookPath = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hookPath], {
      cwd: p.dir,
      input: "{}",
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(String(out.agent_message ?? "")).not.toMatch(/Spawn a Task/);
    expect(String(out.agent_message ?? "")).not.toMatch(/work_unit_id: mod-a/);
  });
});
