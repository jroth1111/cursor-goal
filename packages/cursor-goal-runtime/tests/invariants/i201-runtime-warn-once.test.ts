import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { execCoreHookBare } from "../hooks/exec-hook.js";

describe("I201 runtime missing warn once", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("attaches runtime-missing note to sessionStart, not ignored beforeSubmitPrompt agent_message", async () => {
    const p = await mkGitProject("i201");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const env = { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_GOAL_RUNTIME: "" };
    const session = execCoreHookBare(p.dir, "sessionStart", {}, env);
    const first = execCoreHookBare(p.dir, "beforeSubmitPrompt", {}, env);
    const second = execCoreHookBare(p.dir, "beforeSubmitPrompt", {}, env);
    expect(String(session.stdout.additional_context ?? "")).toContain("runtime not built");
    expect(first.stdout.agent_message).toBeUndefined();
    expect(second.stdout.agent_message ?? "").toBe("");
  });
});
