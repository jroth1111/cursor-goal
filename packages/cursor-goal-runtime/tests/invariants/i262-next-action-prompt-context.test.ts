import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { rankNextAction } from "../../src/lib/next-action.js";
import { writePromptContext } from "../../src/lib/prompt-context.js";
import { runStopPipeline } from "../../src/verifier/pipeline.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";
import type { VerifierContext } from "../../src/verifier/types.js";
import type { WorkUnitCompiled } from "../../src/compile/compile-v2.js";

const unit = (id: string): WorkUnitCompiled => ({
  id,
  title: id,
  scope: ["src/"],
  acceptance: ["done"],
  status: "pending",
  subagent_id: null,
  evidence_path: `evidence/units/${id}.jsonl`,
  role: "implement",
});

const baseCtx = (root = "/tmp"): VerifierContext => ({
  root,
  input: { status: "completed" },
  parsed: {
    goalText: "x",
    nonGoals: [],
    checks: ["true"],
    checkTiers: {},
    scope: [],
    forbiddenProxies: [],
    workUnits: [],
  },
  loopLimit: 40,
  loopCount: 1,
  failures: [],
  checkResults: [{ cmd: "true", ok: true, tree: "t1" }],
  currentTree: "t1",
  phaseBlocked: false,
  unitsBlocked: false,
});

describe("I262 next action prompt-context steering", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("promotes fix_scope when prompt context reports out-of-scope paths", async () => {
    const action = await rankNextAction({
      ctx: baseCtx(),
      promptContext: { mentioned_units: [], out_of_scope_paths: ["docs/README.md"] },
    });
    expect(action?.kind).toBe("fix_scope");
    expect(action?.detail).toMatch(/docs\/README\.md/);
  });

  it("uses valid unit mentions as queue-head overrides and ignores unknown units", async () => {
    const p = await mkGitProject("i262-unit-override");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const units = [unit("unit-a"), unit("unit-b")];

    const valid = await rankNextAction({
      ctx: { ...baseCtx(p.dir), unitsBlocked: true },
      units,
      unitsBlocked: true,
      promptContext: {
        mentioned_units: ["unit-b"],
        unknown_units: [],
        out_of_scope_paths: [],
      },
    });
    expect(valid?.headline).toContain('"unit-b"');

    const invalid = await rankNextAction({
      ctx: { ...baseCtx(p.dir), unitsBlocked: true },
      units,
      unitsBlocked: true,
      promptContext: {
        mentioned_units: [],
        unknown_units: ["missing-unit"],
        out_of_scope_paths: [],
      },
    });
    expect(invalid?.headline).toContain('"unit-a"');
  });

  it("feeds prompt context into stop followup and operator next-action ranking", async () => {
    const p = await mkGitProject("i262-stop-context");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "src"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship x

## Scope
- \`src/\`

## Checks
- \`true\`

## Work Units

### unit-a
Build unit A
- \`src/\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writePromptContext(p.dir, "Please update docs/README.md for work unit unit-a", {
      mode: "governed",
      effectiveMode: "governed",
      interactionModeHint: "delivery",
      conversationId: "agent-262",
    });

    const stop = await runStopPipeline(
      { status: "completed", conversation_id: "agent-262" },
      { dryRun: true },
    );
    expect(stop.kind).toBe("continue");
    expect("message" in stop ? stop.message : "").toMatch(/docs\/README\.md/);

    const snap = await buildOperatorSnapshot(p.dir, { agentId: "agent-262" });
    expect("error" in snap ? snap.error : snap.next_action?.detail).toMatch(/docs\/README\.md/);
  });
});
