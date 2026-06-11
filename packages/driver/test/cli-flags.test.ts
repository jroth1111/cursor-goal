import { describe, expect, it } from "vitest";
import { BOOLEAN_FLAGS, parseFlags } from "../src/lib/cli-flags.js";

describe("parseFlags", () => {
  it("boolean flags never swallow the goal text (the documented invocation shape)", () => {
    const { flags, rest } = parseFlags(["--worktree", "Add a /health endpoint and a passing test"]);
    expect(flags.worktree).toBe(true);
    expect(rest.join(" ")).toBe("Add a /health endpoint and a passing test");

    const dry = parseFlags(["--dry-run", "fix the login bug"]);
    expect(dry.flags["dry-run"]).toBe(true);
    expect(dry.rest.join(" ")).toBe("fix the login bug");

    // unquoted goals lose nothing either
    const multi = parseFlags(["--quiet", "fix", "login", "bug"]);
    expect(multi.flags.quiet).toBe(true);
    expect(multi.rest).toEqual(["fix", "login", "bug"]);
  });

  it("value flags still take the next token or =value, mixed with booleans and rest", () => {
    const { flags, rest } = parseFlags([
      "--max-turns",
      "20",
      "--model=sonnet-4",
      "--worktree",
      "--notify",
      "curl -s http://host/hook",
      "do the thing",
    ]);
    expect(flags["max-turns"]).toBe("20");
    expect(flags.model).toBe("sonnet-4");
    expect(flags.worktree).toBe(true);
    expect(flags.notify).toBe("curl -s http://host/hook");
    expect(rest).toEqual(["do the thing"]);
  });

  it("a value flag at the end of argv degrades to boolean true", () => {
    expect(parseFlags(["--model"]).flags.model).toBe(true);
  });

  it("every boolean flag is covered", () => {
    for (const name of BOOLEAN_FLAGS) {
      const { flags, rest } = parseFlags([`--${name}`, "goal words here"]);
      expect(flags[name]).toBe(true);
      expect(rest).toEqual(["goal words here"]);
    }
  });
});
