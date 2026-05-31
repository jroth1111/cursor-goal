import { describe, it, expect } from "vitest";
import { defaultUnitAcceptance } from "../../src/lib/unit-acceptance-defaults.js";

describe("I92 stronger default unit acceptance", () => {
  it("requires non-empty evidence file instead of path existence", () => {
    const cmds = defaultUnitAcceptance({ id: "unit-a", scope: ["src/a/"] }, []);
    expect(cmds).toEqual(["test -s .cursor/goal/evidence/units/unit-a.jsonl"]);
    expect(cmds.join(" ")).not.toMatch(/test -e/);
  });
});
