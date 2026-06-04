import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { existsSync } from "node:fs";
import { agentDispositionPath, hasAgentDisposition } from "../../src/lib/disposition.js";
import { dispositionForLoop } from "../../src/verifier/l7-loop-budget.js";
import {
  countTrailingSignature,
  readStopSignatureTail,
  recordStopSignature,
  shouldDispositionForRepeat,
} from "../../src/lib/stop-signature.js";
import { readStopTraceTail } from "../../src/lib/stop-trace.js";

describe("I230 repeated-failure disposition", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("shouldDispositionForRepeat requires three trailing matches", () => {
    expect(shouldDispositionForRepeat(2)).toBe(false);
    expect(shouldDispositionForRepeat(3)).toBe(true);
  });

  it("dispositionForLoop triggers on repeated signature before loop budget", () => {
    const ctx = {
      root: "/tmp",
      input: {},
      parsed: { goalText: "x", nonGoals: [], checks: ["false"], checkTiers: {}, scope: [], forbiddenProxies: [], workUnits: [] },
      loopLimit: 40,
      loopCount: 1,
      failures: ["false"],
      checkResults: [{ cmd: "false", ok: false, tree: "t" }],
      currentTree: "t",
    };
    expect(dispositionForLoop(ctx, "blocked", 1, 3)).toBeDefined();
    expect(dispositionForLoop(ctx, "blocked", 1, 2)).toBeUndefined();
  });

  it("writes disposition after three identical blocked stops", async () => {
    const p = await mkGitProject("i230");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    const agentId = "agent-i230";
    const sig = "L3::false";

    for (let i = 0; i < 3; i += 1) {
      const r = await runStopVerifier({
        status: "completed",
        loop_count: i,
        conversation_id: agentId,
      });
      if (i < 2) {
        expect(r.kind).toBe("continue");
      }
    }

    expect(await countTrailingSignature(p.dir, agentId, sig)).toBeGreaterThanOrEqual(3);
    const r3 = await runStopVerifier({
      status: "completed",
      loop_count: 3,
      conversation_id: agentId,
    });
    expect(r3.kind === "disposition" || existsSync(agentDispositionPath(p.dir, agentId))).toBe(
      true,
    );
  });

  it("writes disposition on stop_hook_active after three identical nested failures", async () => {
    const p = await mkGitProject("i230-active");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);

    const agentId = "agent-i230-active";
    for (let i = 0; i < 2; i += 1) {
      const r = await runStopVerifier({
        status: "completed",
        loop_count: i,
        conversation_id: agentId,
        stop_hook_active: true,
      });
      expect(r.kind).toBe("idle");
    }

    const final = await runStopVerifier({
      status: "completed",
      loop_count: 2,
      conversation_id: agentId,
      stop_hook_active: true,
    });
    expect(final.kind).toBe("disposition");
    expect(await hasAgentDisposition(p.dir, agentId)).toBe(true);
    expect(existsSync(agentDispositionPath(p.dir, agentId))).toBe(true);
  });

  it("two identical blocked stops do not write disposition", async () => {
    const p = await mkGitProject("i230-two");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    const agentId = "agent-i230-two";
    for (let i = 0; i < 2; i += 1) {
      const r = await runStopVerifier({
        status: "completed",
        loop_count: i,
        conversation_id: agentId,
      });
      expect(r.kind).toBe("continue");
    }
    expect(await hasAgentDisposition(p.dir, agentId)).toBe(false);
  });

  it("different signature on third stop resets trailing count (no disposition yet)", async () => {
    const p = await mkGitProject("i230-reset");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Checks
- \`false\`
## Scope
- src/
`,
      "utf8",
    );
    await seedReleaseReady(p.dir);
    await compileGoalV2(p.dir);
    const agentId = "agent-i230-reset";
    const sigA = "L3::false";
    await recordStopSignature(p.dir, agentId, sigA);
    await recordStopSignature(p.dir, agentId, sigA);
    expect(await countTrailingSignature(p.dir, agentId, sigA)).toBe(2);

    await writeFile(path.join(p.dir, "RUNBOOK.md"), "# ops\n", "utf8");
    const r3 = await runStopVerifier({
      status: "completed",
      loop_count: 2,
      conversation_id: agentId,
    });
    expect(r3.kind).toBe("continue");
    expect(await hasAgentDisposition(p.dir, agentId)).toBe(false);
    expect(await countTrailingSignature(p.dir, agentId, sigA)).toBe(0);
    const sigB = (await readStopSignatureTail(p.dir, agentId, 1))[0]?.signature;
    expect(sigB).toBeDefined();
    expect(sigB).not.toBe(sigA);
  });

  it("dispositions at loop budget threshold with a fresh signature", async () => {
    const p = await mkGitProject("i230-budget");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    const agentId = "agent-i230-budget";
    const r = await runStopVerifier({
      status: "completed",
      loop_count: 38,
      conversation_id: agentId,
    });
    expect(r.kind).toBe("disposition");
    expect(await hasAgentDisposition(p.dir, agentId)).toBe(true);
    expect(r.message).toMatch(/loop budget exhausted/i);
  });

  it("appendStopTrace records signature on blocked stops", async () => {
    const p = await mkGitProject("i230-trace");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Checks
- \`false\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await runStopVerifier({
      status: "completed",
      loop_count: 0,
      conversation_id: "trace-agent",
    });
    const tail = await readStopTraceTail(p.dir, 1);
    expect(tail[0]?.signature).toMatch(/^L3::false$/);
    expect(tail[0]?.agent_id).toBe("trace-agent");
  });

  it("recordStopSignature trailing count resets when signature changes", async () => {
    const p = await mkGitProject("i230-tail");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const agentId = "tail-agent";
    await recordStopSignature(p.dir, agentId, "L3::a");
    await recordStopSignature(p.dir, agentId, "L3::a");
    expect(await countTrailingSignature(p.dir, agentId, "L3::a")).toBe(2);
    await recordStopSignature(p.dir, agentId, "L4::scope");
    expect(await countTrailingSignature(p.dir, agentId, "L3::a")).toBe(0);
    expect(await countTrailingSignature(p.dir, agentId, "L4::scope")).toBe(1);
  });
});
