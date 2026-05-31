import { describe, it, expect } from "vitest";
import { parseSupervisorArgs } from "../../../../supervisor/run-goal.mjs";

describe("I118 supervisor strict args", () => {
  it("rejects unsupported supervisor flags before deriving launch options", () => {
    expect(() => parseSupervisorArgs(["node", "run-goal.mjs", "--dryrun"])).toThrow(
      /Unknown option: --dryrun/,
    );
  });
});
