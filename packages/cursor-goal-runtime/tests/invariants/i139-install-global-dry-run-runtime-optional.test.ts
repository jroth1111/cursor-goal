import { describe, it, expect, afterEach } from "vitest";
import { cp, mkdir, readFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I139 install-global dry-run runtime optional", () => {
  let fixtureRoot: string;
  let fakeCursorHome: string;
  let fakeHome: string;

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("does not require a built runtime for --skip-build --dry-run", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    fixtureRoot = path.join(os.tmpdir(), `i139-repo-${suffix}`);
    fakeCursorHome = path.join(os.tmpdir(), `i139-cursor-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `i139-home-${suffix}`);
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");

    await mkdir(path.join(fixtureRoot, "scripts/lib"), { recursive: true });
    await cp(
      path.join(repoRoot, "scripts/lib/global-cli-flags.sh"),
      path.join(fixtureRoot, "scripts/lib/global-cli-flags.sh"),
    );
    await mkdir(path.join(fixtureRoot, "core/lib"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "core/.cursor"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "packages/cursor-goal-runtime"), { recursive: true });
    await cp(
      path.join(repoRoot, "scripts/install-global.sh"),
      path.join(fixtureRoot, "scripts/install-global.sh"),
    );
    await cp(
      path.join(repoRoot, "core/lib/merge-hooks-json.sh"),
      path.join(fixtureRoot, "core/lib/merge-hooks-json.sh"),
    );
    await cp(
      path.join(repoRoot, "core/.cursor/hooks.json.user.example"),
      path.join(fixtureRoot, "core/.cursor/hooks.json.user.example"),
    );

    const script = path.join(fixtureRoot, "scripts/install-global.sh");
    const r = spawnSync("bash", [script, "--skip-build", "--dry-run"], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { ...process.env, CURSOR_HOME: fakeCursorHome, HOME: fakeHome },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stderr).not.toMatch(/Runtime not built/);
    expect(existsSync(path.join(fakeCursorHome, "cursor-goal/install-manifest.json"))).toBe(true);
    const manifest = JSON.parse(
      await readFile(path.join(fakeCursorHome, "cursor-goal/install-manifest.json"), "utf8"),
    ) as { dry_run?: boolean };
    expect(manifest.dry_run).toBe(true);
  });
});
