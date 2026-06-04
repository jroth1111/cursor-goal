import { describe, it, expect, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";
import { runStopPipeline } from "../../src/verifier/pipeline.js";
import { seedReleaseReady } from "../helpers/release-ready.js";
import * as runChecks from "../../src/lib/run-checks.js";

describe("I241 operator next_action matches stop dry-run primary", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    vi.restoreAllMocks();
    restore?.();
    await cleanup?.();
  });

  it("next and stop agree on fix_checks when check fails with proof drift", async () => {
    const p = await mkGitProject("i241-parity");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nlong enough goal\n## Checks\n- `false`\n",
      "utf8",
    );
    await seedReleaseReady(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/state.json"),
      JSON.stringify({ last_proof_tree: "proof-tree-old", last_edit_tree: "proof-tree-old" }),
      "utf8",
    );

    vi.spyOn(runChecks, "runChecks").mockResolvedValue([
      { cmd: "false", ok: false, tree: "tree-at-end", output: "expected fail" },
    ]);

    const pipeline = await runStopPipeline(
      { status: "completed", loop_count: 0, conversation_id: "agent-parity" },
      { dryRun: true },
    );
    expect(pipeline.kind).toBe("continue");

    const snap = await buildOperatorSnapshot(p.dir, { conversation_id: "agent-parity" });
    expect("error" in snap).toBe(false);
    if ("error" in snap) return;

    expect(snap.blocked).toBe(true);
    expect(snap.next_action?.kind).toBe("fix_checks");
    expect(snap.blockers).toContain("false");
  });
});
