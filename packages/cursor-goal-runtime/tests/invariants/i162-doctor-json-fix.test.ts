import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I162 doctor json fix output", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  it("emits parseable JSON when --json and --fix are combined", async () => {
    const p = await mkGitProject("i162-doctor-json-fix");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, ".cursor/hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    const stale = path.join(p.dir, ".cursor/goal/NEXT_UNIT.md");
    await writeFile(stale, "old next unit\n", "utf8");

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const runtimeRoot = path.resolve(import.meta.dirname, "../../");
    const r = spawnSync("node", [cli, "doctor", "--json", "--fix"], {
      cwd: p.dir,
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_PROJECT_DIR: p.dir,
        CURSOR_GOAL_RUNTIME: runtimeRoot,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const parsed = JSON.parse(r.stdout) as { issues?: unknown[]; fixes?: string[] };
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.fixes).toContain("removed NEXT_UNIT.md");
    expect(existsSync(stale)).toBe(false);
  });
});
