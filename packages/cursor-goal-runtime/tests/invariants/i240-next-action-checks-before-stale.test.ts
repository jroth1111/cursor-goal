import { describe, it, expect } from "vitest";
import { rankNextAction } from "../../src/lib/next-action.js";
import type { VerifierContext } from "../../src/verifier/types.js";

describe("I240 next action prefers fix_checks over fix_stale_proof", () => {
  it("ranks fix_checks when checks fail and stale-proof is present", async () => {
    const ctx: VerifierContext = {
      root: "/tmp",
      input: { status: "completed" },
      parsed: {
        goalText: "x",
        nonGoals: [],
        checks: ["npm run check"],
        checkTiers: {},
        scope: [],
        forbiddenProxies: [],
        workUnits: [],
      },
      loopLimit: 40,
      loopCount: 1,
      failures: [
        "stale-proof: edits since last proof (abc-wt-deadbeef)",
      ],
      checkResults: [
        { cmd: "npm run check", ok: false, tree: "t1", output: "fail" },
      ],
      currentTree: "t2",
      phaseBlocked: false,
      unitsBlocked: false,
    };

    const action = await rankNextAction({ ctx });
    expect(action?.kind).toBe("fix_checks");
  });

  it("ranks fix_stale_proof when only stale failures exist", async () => {
    const ctx: VerifierContext = {
      root: "/tmp",
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
      failures: ["stale-proof: edits since last proof (abc-wt-deadbeef)"],
      checkResults: [{ cmd: "true", ok: true, tree: "t1" }],
      currentTree: "t2",
      phaseBlocked: false,
      unitsBlocked: false,
    };

    const action = await rankNextAction({ ctx });
    expect(action?.kind).toBe("fix_stale_proof");
  });
});
