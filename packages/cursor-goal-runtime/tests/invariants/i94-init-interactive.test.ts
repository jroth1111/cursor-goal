import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { buildGoalMarkdown, writeInteractiveGoal } from "../../src/lib/init-interactive.js";

describe("I94 init interactive", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("writes non-placeholder Goal and Checks from interactive answers", async () => {
    const p = await mkGitProject("i94");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeInteractiveGoal(p.dir, {
      goal: "Ship the payments API with idempotent webhooks",
      checks: ["npm test", "npm run lint"],
      scopes: ["src/payments/"],
    });
    const md = await readFile(path.join(p.dir, "GOAL.md"), "utf8");
    expect(md).toMatch(/Ship the payments API/);
    expect(md).toMatch(/npm test/);
    expect(md).not.toMatch(/Describe the user-visible outcome in one paragraph/);
    expect(buildGoalMarkdown({ goal: "x", checks: ["true"], scopes: [] })).toMatch(/## Checks/);
  });

  it("CLI init --interactive accepts stdin answers", async () => {
    const p = await mkGitProject("i94-cli");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const input = "CLI goal paragraph\nnpm test\n\nsrc/lib/\n";
    const r = spawnSync("node", [cli, "init", "--interactive"], {
      cwd: p.dir,
      encoding: "utf8",
      input,
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const md = await readFile(path.join(p.dir, "GOAL.md"), "utf8");
    expect(md).toMatch(/CLI goal paragraph/);
    expect(md).toMatch(/npm test/);
  });
});
