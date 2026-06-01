import { describe, expect, it, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I176 install manifest JSON escaping", () => {
  let fakeCursorHome = "";
  let fakeHome = "";

  afterEach(() => {
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
    fakeCursorHome = "";
    fakeHome = "";
  });

  it("writes parseable install-manifest.json when install paths contain JSON metacharacters", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    fakeCursorHome = path.join(os.tmpdir(), `i176-cursor-"quoted"-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `i176-home-"quoted"-${suffix}`);
    const script = path.resolve(import.meta.dirname, "../../../../scripts/install-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../");

    const r = spawnSync("bash", [script, "--skip-build", "--dry-run"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: fakeCursorHome,
        HOME: fakeHome,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);

    const manifestPath = path.join(fakeCursorHome, "cursor-goal/install-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dry_run?: boolean;
      runtime?: string;
    };
    expect(manifest.dry_run).toBe(true);
    expect(manifest.runtime).toBe(path.join(fakeCursorHome, "cursor-goal-runtime"));
  });
});
