import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import {
  extractPromptCommands,
  extractPromptPathRefs,
  extractPromptRuleRefs,
  extractPromptUnitRefs,
  readPromptContext,
  writePromptContext,
} from "../../src/lib/prompt-context.js";

describe("I261 prompt context structured extraction", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("extracts path, rule, command, and unit references from prompt text", () => {
    const prompt =
      "AGENTS.md says update src/lib/a.ts and packages/app/index.ts for work unit unit-a, then run `npm run check` and `cursor-goal next --json`.";
    const paths = extractPromptPathRefs(prompt);
    const commands = extractPromptCommands(prompt);
    const rules = extractPromptRuleRefs(prompt);
    const units = extractPromptUnitRefs(prompt);
    expect(paths).toContain("src/lib/a.ts");
    expect(paths).toContain("packages/app/index.ts");
    expect(rules).toContain("AGENTS.md");
    expect(commands).toContain("npm run check");
    expect(commands).toContain("cursor-goal next --json");
    expect(units).toContain("unit-a");
  });

  it("does not treat prose about unit tests as a work-unit reference", async () => {
    expect(extractPromptUnitRefs("run unit tests")).toEqual([]);
    expect(extractPromptUnitRefs("fix unit tests in src/main.ts")).toEqual([]);

    const p = await mkGitProject("i261-unit-tests-prose");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/scope.json"),
      JSON.stringify({ enforce: true, paths: ["src/"] }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/work-units.json"),
      JSON.stringify({ units: [] }),
      "utf8",
    );

    await writePromptContext(p.dir, "fix unit tests in src/main.ts", {
      mode: "governed",
      effectiveMode: "governed",
      interactionModeHint: "delivery",
      conversationId: "agent-unit-tests",
    });

    const context = await readPromptContext(p.dir, "agent-unit-tests");
    expect(context?.mentioned_units).toEqual([]);
    expect(context?.unknown_units).toEqual([]);
  });

  it("writes per-agent prompt_context with validation results", async () => {
    const p = await mkGitProject("i260-prompt-context");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/scope.json"),
      JSON.stringify({ enforce: true, paths: ["src/"] }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/work-units.json"),
      JSON.stringify({
        units: [
          {
            id: "unit-a",
            title: "Unit A",
            scope: ["src/"],
            acceptance: ["done"],
            status: "pending",
            subagent_id: null,
            evidence_path: "evidence/units/unit-a.jsonl",
            role: "implement",
          },
        ],
      }),
      "utf8",
    );

    const prompt =
      "Verify work unit unit-a and work unit missing-unit by touching src/main.ts and docs/README.md, then run `npm test` after reading INVARIANTS.json";
    await writePromptContext(p.dir, prompt, {
      mode: "governed",
      effectiveMode: "governed",
      interactionModeHint: "delivery",
      conversationId: "agent-260",
    });
    const context = await readPromptContext(p.dir, "agent-260");
    expect(context?.mentioned_paths).toContain("src/main.ts");
    expect(context?.mentioned_paths).toContain("docs/README.md");
    expect(context?.mentioned_rules).toContain("INVARIANTS.json");
    expect(context?.mentioned_commands).toContain("npm test");
    expect(context?.mentioned_units).toContain("unit-a");
    expect(context?.unknown_units).toContain("missing-unit");
    expect(context?.out_of_scope_paths).toContain("docs/README.md");
    expect(context?.unit_role_mismatches).toEqual([
      expect.objectContaining({
        unit_id: "unit-a",
        expected_role: "implement",
        requested_role: "verify",
      }),
    ]);
    expect(context?.effective_mode).toBe("governed");
    expect(context?.interaction_mode_hint).toBe("delivery");

    // Backward-compatible aliases remain available for existing callers.
    expect(context?.paths).toEqual(context?.mentioned_paths);
    expect(context?.commands).toEqual(context?.mentioned_commands);
    expect(context?.unit_ids).toEqual(context?.mentioned_units);
  });

  it("persists prompt context after governed stale compile refreshes scope", async () => {
    const p = await mkGitProject("i261-prompt-context-after-compile");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship v1

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
Ship v2

## Scope
- \`app/\`

## Checks
- \`true\`
`,
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeSubmitPrompt.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        conversation_id: "agent-after-compile",
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
    expect(out.continue).toBe(true);
    expect(out.user_message ?? "").not.toMatch(/outside active GOAL scope/i);

    const context = JSON.parse(
      await readFile(
        path.join(p.dir, ".cursor/goal/agents/agent-after-compile/prompt-context.json"),
        "utf8",
      ),
    ) as { out_of_scope_paths?: string[]; mentioned_paths?: string[] };
    expect(context.mentioned_paths).toContain("app/page.ts");
    expect(context.out_of_scope_paths).not.toContain("app/page.ts");
  });
});
