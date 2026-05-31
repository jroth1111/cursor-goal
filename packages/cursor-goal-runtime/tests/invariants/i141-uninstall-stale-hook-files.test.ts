import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I141 uninstall stale hook files", () => {
  let fakeCursorHome: string;
  let fakeHome: string;

  afterEach(() => {
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("removes stale goal hook files while preserving user hook files", async () => {
    fakeCursorHome = path.join(os.tmpdir(), `i141-cursor-${Date.now()}`);
    fakeHome = path.join(os.tmpdir(), `i141-home-${Date.now()}`);
    await mkdir(path.join(fakeCursorHome, "hooks"), { recursive: true });
    await writeFile(path.join(fakeCursorHome, "hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(path.join(fakeCursorHome, "hooks/goal-old.sh"), "#!/usr/bin/env bash\n", "utf8");
    await writeFile(path.join(fakeCursorHome, "hooks/user-stop.sh"), "#!/usr/bin/env bash\n", "utf8");

    const script = path.resolve(import.meta.dirname, "../../../../scripts/uninstall-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../");
    const r = spawnSync("bash", [script], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CURSOR_HOME: fakeCursorHome, HOME: fakeHome },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(existsSync(path.join(fakeCursorHome, "hooks/goal-stop.sh"))).toBe(false);
    expect(existsSync(path.join(fakeCursorHome, "hooks/goal-old.sh"))).toBe(false);
    expect(existsSync(path.join(fakeCursorHome, "hooks/user-stop.sh"))).toBe(true);
  });
});
