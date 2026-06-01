import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { goalDir } from "../../src/lib/paths.js";
import { sessionEndMarkerPath } from "../../src/lib/disposition.js";

describe("I189 session-end stop blocker precedence", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("does not hide a concrete stop blocker behind a green check result", async () => {
    const p = await mkGitProject("i189-stop-blocker");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(goalDir(p.dir), "evidence"), { recursive: true });
    await writeFile(
      path.join(goalDir(p.dir), "stop-trace.jsonl"),
      `${JSON.stringify({
        at: new Date().toISOString(),
        pipeline_result: "continue",
        level_failed: "L4",
        failures: ["scope enforcement"],
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), cmd: "npm test", ok: true, output: "green" })}\n`,
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
    expect(marker.failure_class).toBe("stop_blocked");
    expect(marker.why_no_release).toMatch(/L4|scope enforcement/i);
  });
});
