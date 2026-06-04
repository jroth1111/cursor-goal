import { describe, it, expect } from "vitest";
import { sanitizeHookResponse } from "../../src/lib/hook-response-schema.js";

describe("I268 hook responses are sanitized to Cursor's event schemas", () => {
  it("drops invalid stop followup values instead of emitting invalid JSON shape", () => {
    const out = sanitizeHookResponse("stop", {
      followup_message: { text: "bad" },
    });

    expect(out).toEqual({});
  });

  it("keeps valid preToolUse rewrite fields and removes invalid permission/message values", () => {
    const out = sanitizeHookResponse("preToolUse", {
      permission: "blocked",
      user_message: 42,
      agent_message: ["bad"],
      updated_input: { file_path: "src/a.ts" },
    });

    expect(out).toEqual({ updated_input: { file_path: "src/a.ts" } });
  });

  it("drops invalid beforeSubmitPrompt control fields", () => {
    const out = sanitizeHookResponse("beforeSubmitPrompt", {
      continue: "true",
      user_message: ["bad"],
      agent_message: "ignored by Cursor",
    });

    expect(out).toEqual({});
  });

  it("drops beforeSubmitPrompt agent_message even when it is a valid string", () => {
    const out = sanitizeHookResponse("beforeSubmitPrompt", {
      continue: true,
      agent_message: "Cursor never displays this",
    });

    expect(out).toEqual({ continue: true });
  });

  it("filters sessionStart env and context values to strings", () => {
    const out = sanitizeHookResponse("sessionStart", {
      additional_context: ["bad"],
      continue: "yes",
      env: { GOOD: "1", BAD: false },
      user_message: "visible warning",
    });

    expect(out).toEqual({
      env: { GOOD: "1" },
      user_message: "visible warning",
    });
  });
});
