import { describe, it, expect } from "vitest";
import {
  formatDispositionMessage,
  formatFollowupMessage,
} from "../../src/lib/runtime-state.js";
import { buildVerifyUnitDetail } from "../../src/lib/unit-task-prompt.js";

describe("I228 loop steering and continuation", () => {
  const baseState = {
    mode: "runtime" as const,
    loop_count: 38,
    loop_limit: 40,
    phase: "VERIFY",
    blocked: true,
    blockers: ["check failed"],
    next_action: {
      kind: "verify_unit" as const,
      headline: 'Close unit "u1" (acceptance already passes)',
      detail: "detail",
    },
    last_check_fail: null,
    updated_at: new Date().toISOString(),
  };

  it("includes loop budget steering when near limit", () => {
    const msg = formatFollowupMessage(baseState, 3, 38, "agent-1", "VERIFY");
    expect(msg).toMatch(/Loop budget nearly exhausted/);
    expect(msg).toMatch(/38\/40/);
  });

  it("includes continuation blurb for VERIFY verify_unit", () => {
    const msg = formatFollowupMessage(baseState, 3, 38, "agent-1", "VERIFY");
    expect(msg).toMatch(/worktree as source of truth/i);
    expect(msg).toMatch(/^State: phase=VERIFY/);
  });

  it("formatDispositionMessage omits loop steering blurb near budget", () => {
    const state = { ...baseState, loop_count: 39, loop_limit: 40 };
    const followup = formatFollowupMessage(state, 39, 39, "agent-1", "VERIFY");
    expect(followup).toMatch(/Loop budget nearly exhausted/);
    const disposition = formatDispositionMessage(state, 39, 39, "agent-1", "budget");
    expect(disposition).toMatch(/loop budget exhausted/i);
    expect(disposition).not.toMatch(/Loop budget nearly exhausted/);
  });

  it("formatDispositionMessage uses repeated-failure title when requested", () => {
    const msg = formatDispositionMessage(baseState, 3, 3, "agent-1", "repeated_failure");
    expect(msg).toMatch(/Disposition — repeated failure/);
  });

  it("verify detail without verified_by omits dispatch --verify", () => {
    const detail = buildVerifyUnitDetail({
      id: "u1",
      title: "U1",
      scope: ["src/"],
      acceptance: ["true"],
      status: "pending",
      subagent_id: null,
      evidence_path: "evidence/units/u1.jsonl",
      role: "implement",
      verified_by: null,
    });
    expect(detail).toMatch(/units done u1/);
    expect(detail).not.toMatch(/dispatch --verify/);
  });
});
