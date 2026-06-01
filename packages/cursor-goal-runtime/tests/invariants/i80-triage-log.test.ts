import { describe, it, expect, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { classifyPrompt, appendTriageLog, readLastTriageEntry } from "../../src/lib/prompt-triage.js";

describe("I80 triage log", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("appends triage entry and reads it back by conversation id", async () => {
    const p = await mkGitProject("i80");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const prompt = "implement auth middleware until tests pass";
    const classification = classifyPrompt(prompt);
    expect(classification.deliveryScore).toBeGreaterThan(0);
    await appendTriageLog(p.dir, prompt, "nudge", "conv-80", ["extra"]);
    const entry = await readLastTriageEntry(p.dir, "conv-80");
    expect(entry?.agent_id).toBe("conv-80");
    expect(entry?.mode).toBe("nudge");
    expect(entry?.reasons ?? []).toContain("extra");
    expect(entry?.prompt_hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("creates the goal directory before appending triage evidence", async () => {
    const p = await mkGitProject("i80-missing-goal-dir");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await rm(path.join(p.dir, ".cursor/goal"), { recursive: true, force: true });

    await appendTriageLog(p.dir, "implement the fix", "nudge", "conv-missing-dir");

    const entry = await readLastTriageEntry(p.dir, "conv-missing-dir");
    expect(entry?.agent_id).toBe("conv-missing-dir");
    expect(entry?.mode).toBe("nudge");
  });
});
