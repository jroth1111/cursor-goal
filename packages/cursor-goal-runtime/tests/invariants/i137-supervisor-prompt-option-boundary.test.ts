import { describe, it, expect } from "vitest";
import { parseSupervisorArgs } from "../../../../supervisor/run-goal.mjs";

describe("I137 supervisor prompt option boundary", () => {
  it("treats text after --prompt as prompt content, not supervisor options", () => {
    const parsed = parseSupervisorArgs([
      "node",
      "run-goal.mjs",
      "--prompt",
      "--dry-run",
      "--wall-min=abc",
    ]);

    expect(parsed.prompt).toBe("--dry-run --wall-min=abc");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.wallMin).toBe(120);
  });
});
