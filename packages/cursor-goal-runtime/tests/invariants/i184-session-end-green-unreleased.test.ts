import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { goalDir } from "../../src/lib/paths.js";
import { sessionEndMarkerPath } from "../../src/lib/disposition.js";

describe("I184 green but unreleased session-end classification", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("classifies passed checks without RELEASE as green_but_unreleased", async () => {
    const p = await mkGitProject("i184-green-unreleased");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(goalDir(p.dir), "evidence"), { recursive: true });
    await writeFile(
      path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), cmd: "npm test", ok: true, tree: "abc", output: "all good" })}\n`,
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionEnd.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "agent-a" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const marker = JSON.parse(await readFile(sessionEndMarkerPath(p.dir), "utf8")) as {
      failure_class?: string;
      why_no_release?: string;
    };
    expect(marker.failure_class).toBe("green_but_unreleased");
    expect(marker.why_no_release).toMatch(/checks passed/i);
  });
});
