import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import {
  hasAgentDisposition,
  writeAgentDisposition,
} from "../../src/lib/disposition.js";
import { readRepoRuntimeSummary } from "../../src/lib/runtime-state.js";

async function mkPlainProject(prefix: string): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(path.join(dir, ".cursor", "goal", "passports"), {
    recursive: true,
  });
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

async function seedGoal(
  dir: string,
  options?: { scope?: string[]; unitId?: string; acceptance?: string },
): Promise<void> {
  const scope = options?.scope ?? ["decompile/"];
  const unitId = options?.unitId ?? "har-recover-tools";
  const acceptance = options?.acceptance ?? "`true`";
  await writeFile(
    path.join(dir, "GOAL.md"),
    `## Goal
Recover HAR tooling

## Scope
${scope.map((item) => `- \`${item}\``).join("\n")}

## Work units
### ${unitId}
HAR recovery tools
${scope.map((item) => `- scope: \`${item}\``).join("\n")}
- acceptance: ${acceptance}

## Checks
- \`true\`
`,
    "utf8",
  );
  for (const item of scope) {
    if (item.endsWith("/")) await mkdir(path.join(dir, item), { recursive: true });
  }
}

describe("I245 edgeflo incident hardening", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("records edit paths so non-git projects still block out-of-scope release", async () => {
    const p = await mkPlainProject("i245-non-git-scope");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir);
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("har-recover-tools", p.dir);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-postToolUse.mjs");
    const post = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: "app/routes/notebook.tsx",
        tool_input: { file_path: "app/routes/notebook.tsx" },
        conversation_id: "edgeflo-agent",
        exit_code: 0,
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_GOAL_STOP_FOLLOWUP: "1" },
    });
    expect(post.status).toBe(0);

    const result = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "edgeflo-agent",
    });
    expect(result.kind).toBe("continue");
    if (result.kind === "continue") {
      expect(result.message).toMatch(/out-of-scope: app\/routes\/notebook\.tsx/);
    }
  });

  it("keeps primary writes advisory by default but denies out-of-scope writes when configured strict", async () => {
    const p = await mkGitProject("i245-strict-primary-write");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir, { scope: ["src/"], unitId: "src-work" });
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "governed", write_policy: "deny_out_of_scope" }),
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: "lib/outside.ts",
        conversation_id: "strict-agent",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(out.permission).toBe("deny");
    expect(out.agent_message).toMatch(/WriteGate: lib\/outside\.ts outside scope/);
  });

  it("does not derive strict primary write scope from uncompiled live GOAL markdown", async () => {
    const p = await mkGitProject("i245-uncompiled-write-scope");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir, { scope: ["src/"], unitId: "src-work" });
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/config.json"),
      JSON.stringify({ default_mode: "governed", write_policy: "deny_out_of_scope" }),
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-preToolUse.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: "lib/outside.ts",
        conversation_id: "uncompiled-scope-agent",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(out.permission).toBe("allow");
  });

  it("clears stale default-agent disposition when another conversation reaches release", async () => {
    const p = await mkGitProject("i245-default-disposition");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir, { scope: ["pkg/"], unitId: "pkg" });
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("pkg", p.dir);
    await writeAgentDisposition(
      p.dir,
      "default",
      {
        status: "DISPOSITION",
        recoverable: true,
        failed: ["stale verifier error"],
        loop_count: 40,
        agent_id: "default",
        at: new Date().toISOString(),
      },
      "stale default disposition\n",
    );

    const result = await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "real-edgeflo-agent",
    });
    expect(result.kind).toBe("release");
    expect(await hasAgentDisposition(p.dir, "default")).toBe(false);
    const summary = await readRepoRuntimeSummary(p.dir);
    expect(summary?.blocked_agent_count ?? 0).toBe(0);
  });

  it("stop refuses uncompiled malformed GOAL instead of parsing acceptance prose", async () => {
    const p = await mkPlainProject("i245-stop-error");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir, {
      scope: ["tools/har-recover/"],
      unitId: "har-recover-tools",
      acceptance: "Run `python3 tools/har-recover/recover.py --help` and document the pipeline",
    });
    await writeSessionMode(p.dir, "governed", "cli");

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-stop.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        loop_count: 0,
        conversation_id: "parse-agent",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(out.followup_message).toBeUndefined();

    const optIn = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        loop_count: 0,
        conversation_id: "parse-agent",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_GOAL_STOP_FOLLOWUP: "1" },
    });
    expect(optIn.status).toBe(0);
    const optInOut = JSON.parse((optIn.stdout ?? "{}").trim() || "{}");
    expect(optInOut.followup_message).toMatch(/Compiled GOAL artifacts missing|cursor-goal compile/i);
    expect(optInOut.followup_message).not.toMatch(/har-recover-tools/);
    expect(optInOut.followup_message).not.toMatch(/acceptance must be/i);

    const errPath = path.join(p.dir, ".cursor/goal/stop-error.json");
    expect(existsSync(errPath)).toBe(false);
  });

  it("warns on governed prompts that name paths outside active GOAL scope", async () => {
    const p = await mkGitProject("i245-prompt-scope");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedGoal(p.dir);
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "governed", "cli");

    const hook = path.resolve(
      import.meta.dirname,
      "../../dist/hook-beforeSubmitPrompt.mjs",
    );
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        prompt: "Refactor app/routes/notebook and academy layouts",
        conversation_id: "prompt-agent",
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}");
    expect(out.continue).toBe(false);
    expect(out.user_message).toMatch(/outside active GOAL scope/);
    expect(out.user_message).toMatch(/app\/routes\/notebook/);
    expect(out.user_message).toMatch(/decompile\//);
  });
});
