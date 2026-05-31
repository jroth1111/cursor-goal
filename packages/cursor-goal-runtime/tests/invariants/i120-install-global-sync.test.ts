import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I120 global install schema/template sync", () => {
  let fakeCursorHome: string;
  let fakeHome: string;
  let fakeBin: string;

  afterEach(() => {
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });

  it("removes stale schema and template files before copying current install artifacts", async () => {
    fakeCursorHome = path.join(os.tmpdir(), `i120-cursor-${Date.now()}`);
    fakeHome = path.join(os.tmpdir(), `i120-home-${Date.now()}`);
    fakeBin = path.join(os.tmpdir(), `i120-bin-${Date.now()}`);
    await mkdir(path.join(fakeCursorHome, "goal/schemas"), { recursive: true });
    await mkdir(path.join(fakeCursorHome, "goal/templates"), { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await writeFile(path.join(fakeCursorHome, "goal/schemas/stale-schema.json"), "{}", "utf8");
    await writeFile(path.join(fakeCursorHome, "goal/templates/STALE.md"), "stale\n", "utf8");
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
    expect(existsSync(path.join(fakeCursorHome, "goal/schemas/agent-runtime-state.json"))).toBe(
      true,
    );
    expect(existsSync(path.join(fakeCursorHome, "goal/templates/GOAL.md"))).toBe(true);
    expect(existsSync(path.join(fakeCursorHome, "goal/schemas/stale-schema.json"))).toBe(false);
    expect(existsSync(path.join(fakeCursorHome, "goal/templates/STALE.md"))).toBe(false);
  });
});
