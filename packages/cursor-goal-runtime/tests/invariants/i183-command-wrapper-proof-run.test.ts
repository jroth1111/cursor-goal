import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { goalDir } from "../../src/lib/paths.js";

describe("I183 cursor-goal run command wrapper", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("captures command output and appends proof-run evidence", async () => {
    const p = await mkGitProject("i183-run-proof");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const r = spawnSync("node", [cli, "run", "--", "node", "-e", "console.log('wrapped-ok')"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toContain("wrapped-ok");
    const raw = await readFile(path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"), "utf8");
    const row = JSON.parse(raw.trim().split(/\r?\n/).at(-1) ?? "{}") as {
      cmd?: string;
      ok?: boolean;
      elapsed_ms?: number;
      output?: string;
      source?: string;
    };
    expect(row.cmd).toContain("node -e");
    expect(row.ok).toBe(true);
    expect(row.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(row.output).toContain("wrapped-ok");
    expect(row.source).toBe("cursor-goal run");
  });

  it("times out long commands and records the timeout", async () => {
    const p = await mkGitProject("i183-run-timeout");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const r = spawnSync(
      "node",
      [cli, "run", "--timeout-ms", "100", "--", "node", "-e", "setTimeout(() => {}, 1000)"],
      {
        cwd: p.dir,
        encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
      },
    );

    expect(r.status).not.toBe(0);
    const raw = await readFile(path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"), "utf8");
    const row = JSON.parse(raw.trim().split(/\r?\n/).at(-1) ?? "{}") as {
      ok?: boolean;
      timed_out?: boolean;
      output?: string;
    };
    expect(row.ok).toBe(false);
    expect(row.timed_out).toBe(true);
    expect(row.output).toMatch(/timed out/i);
  });
});
