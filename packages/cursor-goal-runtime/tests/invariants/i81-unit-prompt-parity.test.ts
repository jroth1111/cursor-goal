import { describe, it, expect } from "vitest";
import { buildUnitTaskPrompt } from "../../src/lib/unit-task-prompt.js";
import { buildUnitTaskPrompt as supervisorBuild } from "../../../../supervisor/unit-prompt.mjs";

describe("I81 unit task prompt parity", () => {
  it("supervisor prompt matches runtime for same unit", () => {
    const unit = {
      id: "auth-middleware",
      title: "Auth middleware",
      scope: ["src/auth/"],
      acceptance: ["npm test -- src/auth"],
    };
    expect(supervisorBuild(unit)).toBe(buildUnitTaskPrompt(unit as never));
  });
});
