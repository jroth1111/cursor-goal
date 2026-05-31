import { describe, it, expect } from "vitest";
import { parseSupervisorArgs } from "../../../../supervisor/run-goal.mjs";

describe("I119 supervisor wall-clock values", () => {
  it("rejects invalid wall-clock values before deriving timeout behavior", () => {
    expect(() => parseSupervisorArgs(["node", "run-goal.mjs", "--wall-min=abc"])).toThrow(
      /Invalid value for --wall-min: abc/,
    );
  });
});
