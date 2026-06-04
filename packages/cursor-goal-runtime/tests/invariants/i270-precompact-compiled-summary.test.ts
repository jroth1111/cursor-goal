import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

function runPreCompact(root: string): Record<string, unknown> {
  const hook = path.resolve(import.meta.dirname, "../../dist/hook-preCompact.mjs");
  const r = spawnSync("node", [hook], {
    cwd: root,
    input: JSON.stringify({ conversation_id: "conv-a" }),
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: root },
  });
  expect(r.status, r.stderr || r.stdout).toBe(0);
  return JSON.parse((r.stdout ?? "{}").trim() || "{}") as Record<string, unknown>;
}

describe("I270 preCompact includes compiled checks and release status", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("summarizes checks from the compiled goal snapshot and current RELEASE passport", async () => {
    const p = await mkGitProject("i270-precompact-summary");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      [
        "## Goal",
        "Preserve compacted governance context",
        "## Checks",
        "- [fast] `true`",
        "- [full] `node -e \"process.exit(0)\"`",
        "",
      ].join("\n"),
      "utf8",
    );
    await compileGoalV2(p.dir);

    const missing = String(runPreCompact(p.dir).user_message ?? "");
    expect(missing).toContain('checks: [fast] true; [full] node -e "process.exit(0)"');
    expect(missing).toContain("release: missing");

    await mkdir(path.join(p.dir, ".cursor/goal/passports"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/passports/RELEASE.json"),
      JSON.stringify({ status: "RELEASE" }),
      "utf8",
    );

    const present = String(runPreCompact(p.dir).user_message ?? "");
    expect(present).toContain("release: present");
    expect(present.length).toBeLessThanOrEqual(2000);
  });
});
