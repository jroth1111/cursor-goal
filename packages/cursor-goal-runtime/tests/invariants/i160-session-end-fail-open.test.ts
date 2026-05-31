import { describe, it, expect, afterEach } from "vitest";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { sessionEndMarkerPath } from "../../src/lib/disposition.js";

describe("I160 sessionEnd fail-open", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("returns a JSON warning instead of crashing when SESSION_END cannot be written", async () => {
    const p = await mkGitProject("i160-session-end-fail-open");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(sessionEndMarkerPath(p.dir), { recursive: true });

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionEnd.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "agent-a" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as { agent_message?: string };
    expect(out.agent_message).toMatch(/sessionEnd warning|continuing fail-open/i);
  });
});
