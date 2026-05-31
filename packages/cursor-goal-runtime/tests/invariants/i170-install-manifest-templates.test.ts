import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I170 global install manifest template path", () => {
  let fakeCursorHome = "";
  let fakeHome = "";
  let fakeBin = "";

  afterEach(() => {
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
    fakeCursorHome = "";
    fakeHome = "";
    fakeBin = "";
  });

  it("records the installed templates directory in the manifest", async () => {
    const suffix = `${process.pid}-${Date.now()}`;
    fakeCursorHome = path.join(os.tmpdir(), `i170-cursor-${suffix}`);
    fakeHome = path.join(os.tmpdir(), `i170-home-${suffix}`);
    fakeBin = path.join(os.tmpdir(), `i170-bin-${suffix}`);
    await mkdir(fakeBin, { recursive: true });
    await writeFile(path.join(fakeBin, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const script = path.resolve(import.meta.dirname, "../../../../scripts/install-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../");
    const r = spawnSync("bash", [script, "--skip-build"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_HOME: fakeCursorHome,
        HOME: fakeHome,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);

    const manifestPath = path.join(fakeCursorHome, "cursor-goal/install-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      runtime?: string;
      schemas?: string;
      templates?: string;
      hooks?: string;
    };

    expect(manifest.runtime).toBe(path.join(fakeCursorHome, "cursor-goal-runtime"));
    expect(manifest.schemas).toBe(path.join(fakeCursorHome, "goal/schemas"));
    expect(manifest.templates).toBe(path.join(fakeCursorHome, "goal/templates"));
    expect(manifest.hooks).toBe(path.join(fakeCursorHome, "hooks"));
    expect(existsSync(path.join(manifest.templates ?? "", "GOAL.md"))).toBe(true);
  });
});
