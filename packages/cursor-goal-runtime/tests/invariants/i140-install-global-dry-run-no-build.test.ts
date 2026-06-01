import { describe, it, expect, afterEach } from "vitest";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I140 install-global dry-run skips build", () => {
  let fixtureRoot: string;
  let fakeCursorHome: string;
  let fakeHome: string;
  let fakeBin: string;

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });

  it("does not run npm build during --dry-run", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    fixtureRoot = path.join(os.tmpdir(), `i140-repo-${suffix}`);
    fakeCursorHome = path.join(os.tmpdir(), `i140-cursor-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `i140-home-${suffix}`);
    fakeBin = path.join(os.tmpdir(), `i140-bin-${suffix}`);
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");

    await mkdir(path.join(fixtureRoot, "scripts/lib"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "core/lib"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "core/.cursor"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "packages/cursor-goal-runtime"), { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await cp(
      path.join(repoRoot, "scripts/install-global.sh"),
      path.join(fixtureRoot, "scripts/install-global.sh"),
    );
    await cp(
      path.join(repoRoot, "scripts/lib/global-cli-flags.sh"),
      path.join(fixtureRoot, "scripts/lib/global-cli-flags.sh"),
    );
    await cp(
      path.join(repoRoot, "core/lib/merge-hooks-json.sh"),
      path.join(fixtureRoot, "core/lib/merge-hooks-json.sh"),
    );
    await cp(
      path.join(repoRoot, "core/.cursor/hooks.json.user.example"),
      path.join(fixtureRoot, "core/.cursor/hooks.json.user.example"),
    );
    const fakeNpm = path.join(fakeBin, "npm");
    await writeFile(fakeNpm, "#!/bin/sh\necho npm-called > \"$FAKE_NPM_MARKER\"\nexit 42\n", "utf8");
    await chmod(fakeNpm, 0o755);

    const marker = path.join(fakeBin, "npm-marker");
    const script = path.join(fixtureRoot, "scripts/install-global.sh");
    const r = spawnSync("bash", [script, "--dry-run"], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: fakeCursorHome,
        HOME: fakeHome,
        FAKE_NPM_MARKER: marker,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(existsSync(marker)).toBe(false);
    const manifest = JSON.parse(
      await readFile(path.join(fakeCursorHome, "cursor-goal/install-manifest.json"), "utf8"),
    ) as { dry_run?: boolean };
    expect(manifest.dry_run).toBe(true);
  });
});
