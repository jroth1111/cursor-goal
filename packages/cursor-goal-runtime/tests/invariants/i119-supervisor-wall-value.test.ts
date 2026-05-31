import { describe, it, expect } from "vitest";
import { parseSupervisorArgs } from "../../../../supervisor/run-goal.mjs";

describe("I119 supervisor wall-clock values", () => {
  it("rejects invalid wall-clock values before deriving timeout behavior", () => {
    expect(() => parseSupervisorArgs(["node", "run-goal.mjs", "--wall-min=abc"])).toThrow(
      /Invalid value for --wall-min: abc/,
    );
  });

  it("rejects duplicate wall-clock values instead of silently ignoring one", () => {
    expect(() =>
      parseSupervisorArgs(["node", "run-goal.mjs", "--wall-min=1", "--wall-min=2"]),
    ).toThrow(/Duplicate option: --wall-min/);
    expect(() =>
      parseSupervisorArgs(["node", "run-goal.mjs", "--wall-sec=1", "--wall-sec=2"]),
    ).toThrow(/Duplicate option: --wall-sec/);
  });
});
