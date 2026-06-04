import { describe, it, expect } from "vitest";
import { formatFollowupMessage } from "../../src/lib/runtime-state.js";

describe("I221 follow-up clarity", () => {
  it("includes State line and omits stale phase from Also blocked during adversarial stop", () => {
    const msg = formatFollowupMessage(
      {
        mode: "runtime",
        loop_count: 2,
        loop_limit: 40,
        phase: "VERIFY",
        blocked: true,
        blockers: ["phase:DISCOVERY", "adversarial-missing-verdict: u1"],
        next_action: {
          kind: "fix_other",
          headline: "Missing deliverable or VERDICT:PASS for unit(s) u1",
          detail: "Run: cursor-goal dispatch --verify --unit <id>",
        },
        last_check_fail: null,
        updated_at: new Date().toISOString(),
      },
      5,
      2,
      "agent-1",
      "VERIFY",
    );
    expect(msg).toMatch(/^State: phase=VERIFY blocked=true primary=fix_other/);
    expect(msg).not.toMatch(/Also blocked[\s\S]*phase:DISCOVERY/);
  });
});
