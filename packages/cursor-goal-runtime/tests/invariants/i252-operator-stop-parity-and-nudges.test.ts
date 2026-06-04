import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";
import { writeAgentRuntimeState } from "../../src/lib/agent-runtime-state.js";
import {
  markUnitDoneWithEvidence,
  seedReleaseReady,
} from "../helpers/release-ready.js";

describe("I252 operator parity and blocked nudges", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("operator snapshot blocks on the same adversarial gate as stop", async () => {
    const p = await mkGitProject("i252-operator-adversarial");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship verified unit

## Work units

### u1
Unit
- scope: \`src/\`
- verified_by: verifier
- acceptance: \`true\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await markUnitDoneWithEvidence("u1", p.dir);

    const snap = await buildOperatorSnapshot(p.dir, {
      conversation_id: "operator-adversarial",
    });
    expect("error" in snap).toBe(false);
    if ("error" in snap) return;
    expect(snap.blocked).toBe(true);
    expect(snap.blockers.join("\n")).toMatch(/adversarial|VERDICT|u1/i);
    expect(snap.next_action?.kind).toBe("fix_other");
  });

  it("postToolUse formats blocked next_action instead of stringifying an object", async () => {
    const p = await mkGitProject("i252-posttool-nudge");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const agentId = "nudge-agent";
    await mkdir(path.join(p.dir, ".cursor/goal/agents", agentId), { recursive: true });
    await writeAgentRuntimeState(p.dir, agentId, {
      mode: "runtime",
      loop_count: 1,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["false"],
      next_action: {
        kind: "fix_checks",
        headline: "Fix checks",
        detail: "Run npm test and address the failing assertion.",
      },
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-postToolUse.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Read",
        tool_output: "ok",
        conversation_id: agentId,
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = JSON.parse(r.stdout) as { additional_context?: string };
    expect(out.additional_context).toContain("Fix checks");
    expect(out.additional_context).toContain("Run npm test");
    expect(out.additional_context).not.toContain("[object Object]");
  });

  it("operator snapshot uses the compiled GOAL boundary instead of reparsing stale live GOAL", async () => {
    const p = await mkGitProject("i252-operator-compiled-boundary");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship compiled contract

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship edited contract

## Checks
- [fast] npm test
`,
      "utf8",
    );

    const snap = await buildOperatorSnapshot(p.dir, {
      conversation_id: "operator-compiled-boundary",
    });
    expect("error" in snap).toBe(true);
    if ("error" in snap) {
      expect(snap.error).toMatch(/GOAL\.md changed after compile|cursor-goal compile/i);
      expect(snap.error).not.toMatch(/backticked shell command/i);
    }
  });
});
