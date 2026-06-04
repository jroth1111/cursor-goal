import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { isGoalStale } from "../../src/lib/compile-stale.js";

describe("I19 compile gate", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("detects stale GOAL.md after compile", async () => {
    const p = await mkGitProject("i19");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(await isGoalStale(p.dir)).toBe(false);
    const now = Date.now() / 1000 + 60;
    await utimes(path.join(p.dir, "GOAL.md"), now, now);
    expect(await isGoalStale(p.dir)).toBe(true);
  });

  it("governed beforeSubmitPrompt reports stale compile before stale scope warnings", async () => {
    const p = await mkGitProject("i19-before-submit-order");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Scope
- \`src/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "governed", governed_prompt_block: true }),
      "utf8",
    );

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Scope
- \`app/\`

## Checks
- [fast] npm test
`,
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        conversation_id: "agent-stale-compile",
        prompt: "Implement app/page.ts",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as {
      continue?: boolean;
      user_message?: string;
    };
    expect(out.continue).toBe(false);
    expect(out.user_message ?? "").toMatch(/compile|GOAL\.md|backticked shell command/i);
    expect(out.user_message ?? "").not.toMatch(/outside active GOAL scope/i);
  });
});
