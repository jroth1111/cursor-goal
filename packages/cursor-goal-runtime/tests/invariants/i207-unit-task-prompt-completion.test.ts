import { describe, it, expect } from "vitest";
import { buildUnitTaskPrompt } from "../../src/lib/unit-task-prompt.js";

describe("I207 unit task prompt completion discipline", () => {
  it("includes work_unit_id, scope, and completion guardrails", () => {
    const prompt = buildUnitTaskPrompt({
      id: "wu-1",
      title: "Example unit",
      scope: ["src/"],
      acceptance: ["npm test"],
      status: "open",
      verified_by: "",
    } as never);

    expect(prompt).toMatch(/work_unit_id: wu-1/);
    expect(prompt).toMatch(/Allowed scope: src\//);
    expect(prompt).toMatch(/Completion:/);
    expect(prompt).toMatch(/one final summary/i);
    expect(prompt).toMatch(/nested review subagents/i);
  });
});
