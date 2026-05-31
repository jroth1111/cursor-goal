import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I144 core install cursor home", () => {
  let tempDir = "";

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("uses CURSOR_HOME when detecting an existing global runtime", async () => {
    tempDir = path.join(os.tmpdir(), `i144-core-install-${Date.now()}`);
    const target = path.join(tempDir, "target");
    const fakeHome = path.join(tempDir, "home");
    const fakeCursorHome = path.join(tempDir, "cursor-home");
    await mkdir(target, { recursive: true });
    await mkdir(fakeHome, { recursive: true });
    const hookStop = path.join(fakeCursorHome, "cursor-goal-runtime/dist/hook-stop.mjs");
    await mkdir(path.dirname(hookStop), { recursive: true });
    await writeFile(hookStop, "", "utf8");

    const installSh = path.resolve(import.meta.dirname, "../../../../core/install.sh");
    const r = spawnSync("bash", [installSh, target], {
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome, CURSOR_HOME: fakeCursorHome },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toContain("Global cursor-goal runtime detected");
    expect(existsSync(path.join(target, ".cursor/hooks/goal-stop.sh"))).toBe(false);
  });
});
