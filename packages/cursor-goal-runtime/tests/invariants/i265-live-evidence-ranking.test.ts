import { describe, it, expect } from "vitest";
import { rankNextAction } from "../../src/lib/next-action.js";
import type { VerifierContext } from "../../src/verifier/types.js";

const ctx = (overrides: Partial<VerifierContext> = {}): VerifierContext => ({
  root: "/tmp",
  input: { status: "completed" },
  parsed: {
    goalText: "x",
    nonGoals: [],
    checks: ["npm run check"],
    checkTiers: {},
    scope: ["src/"],
    forbiddenProxies: [],
    workUnits: [],
  },
  loopLimit: 40,
  loopCount: 1,
  failures: [],
  checkResults: [{ cmd: "npm run check", ok: true, tree: "tree" }],
  currentTree: "tree",
  phaseBlocked: false,
  unitsBlocked: false,
  ...overrides,
});

describe("I265 live-evidence blocker ranking", () => {
  it("ranks current check failures above prompt-context scope hints and stale proof", async () => {
    const action = await rankNextAction({
      ctx: ctx({
        failures: ["stale-proof: prior proof tree differs"],
        checkResults: [
          { cmd: "npm run check", ok: false, tree: "tree", output: "type error" },
        ],
      }),
      promptContext: {
        mentioned_units: [],
        out_of_scope_paths: ["docs/README.md"],
      },
    });

    expect(action?.kind).toBe("fix_checks");
    expect(action?.headline).toContain("npm run check");
  });

  it("ranks fresh stale-proof blockers above scope hints when checks are green", async () => {
    const action = await rankNextAction({
      ctx: ctx({
        failures: ["stale-proof:fingerprint_delta"],
      }),
      promptContext: {
        mentioned_units: [],
        out_of_scope_paths: ["docs/README.md"],
      },
    });

    expect(action?.kind).toBe("fix_stale_proof");
  });
});
