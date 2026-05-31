import { describe, it, expect } from "vitest";
import { parseSupervisorArgs } from "../../../../supervisor/run-goal.mjs";

describe("I138 supervisor prompt value", () => {
  it("rejects --prompt without prompt text before deriving launch options", () => {
    expect(() => parseSupervisorArgs(["node", "run-goal.mjs", "--prompt"])).toThrow(
      /Missing value for --prompt/,
    );
  });
});
