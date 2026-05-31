import { describe, it, expect } from "vitest";
import { parseSupervisorArgs } from "../../../../supervisor/run-goal.mjs";

describe("I156 supervisor mode conflicts", () => {
  it("rejects supervisor modes that would silently ignore unit or parent execution flags", () => {
    expect(() => parseSupervisorArgs(["node", "run-goal.mjs", "--parent-only", "--units-only"])).toThrow(
      /--parent-only cannot be combined with --units-only/,
    );
    expect(() =>
      parseSupervisorArgs(["node", "run-goal.mjs", "--parent-only", "--dispatch-units"]),
    ).toThrow(/--parent-only cannot be combined with --dispatch-units/);
  });
});
