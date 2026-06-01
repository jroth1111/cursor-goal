import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I204 global install script flag parity", () => {
  let fakeCursorHome: string;
  let fakeHome: string;
  let fakeRepo: string;

  afterEach(() => {
    for (const p of [fakeCursorHome, fakeHome, fakeRepo]) {
      if (p) rmSync(p, { recursive: true, force: true });
    }
  });

  async function seedCursorHome() {
    fakeCursorHome = path.join(os.tmpdir(), `i204-cursor-${Date.now()}`);
    fakeHome = path.join(os.tmpdir(), `i204-home-${Date.now()}`);
    await mkdir(path.join(fakeCursorHome, "hooks"), { recursive: true });
    await writeFile(path.join(fakeCursorHome, "hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
  }

  it("install-global.sh rejects unknown flags", async () => {
    await seedCursorHome();
    const script = path.resolve(import.meta.dirname, "../../../../scripts/install-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const r = spawnSync("bash", [script, "--skip-bild"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CURSOR_HOME: fakeCursorHome, HOME: fakeHome },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --skip-bild/);
  });

  it("uninstall-global.sh rejects unknown flags before removing hooks", async () => {
    await seedCursorHome();
    const script = path.resolve(import.meta.dirname, "../../../../scripts/uninstall-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const r = spawnSync("bash", [script, "--purge-runtim"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CURSOR_HOME: fakeCursorHome, HOME: fakeHome },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --purge-runtim/);
    expect(existsSync(path.join(fakeCursorHome, "hooks/goal-stop.sh"))).toBe(true);
  });

  it("core/install.sh rejects unknown flags", async () => {
    fakeRepo = path.join(os.tmpdir(), `i204-repo-${Date.now()}`);
    await mkdir(fakeRepo, { recursive: true });
    const script = path.resolve(import.meta.dirname, "../../../../core/install.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const r = spawnSync("bash", [script, fakeRepo, "--local-hookz"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --local-hookz/);
  });
});
