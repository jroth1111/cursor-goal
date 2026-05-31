import { describe, it, expect, afterEach } from "vitest";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I121 global install hook sync", () => {
  let fakeCursorHome: string;
  let fakeHome: string;
  let fakeBin: string;

  afterEach(() => {
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });

  it("removes stale cursor-goal hook entries and files while preserving user hooks", async () => {
    fakeCursorHome = path.join(os.tmpdir(), `i121-cursor-${Date.now()}`);
    fakeHome = path.join(os.tmpdir(), `i121-home-${Date.now()}`);
    fakeBin = path.join(os.tmpdir(), `i121-bin-${Date.now()}`);
    await mkdir(path.join(fakeCursorHome, "hooks"), { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await writeFile(path.join(fakeCursorHome, "hooks/goal-old.sh"), "#!/bin/sh\n", "utf8");
    await writeFile(path.join(fakeCursorHome, "hooks/user-stop.sh"), "#!/bin/sh\n", "utf8");
    await writeFile(
      path.join(fakeCursorHome, "hooks.json"),
      `${JSON.stringify(
        {
          version: 1,
          hooks: {
            stop: [
              { command: "hooks/user-stop.sh" },
              { command: "hooks/goal-old.sh", timeout: 1 },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const fakeNpm = path.join(fakeBin, "npm");
    await writeFile(fakeNpm, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(fakeNpm, 0o755);

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
    const hooks = JSON.parse(await readFile(path.join(fakeCursorHome, "hooks.json"), "utf8")) as {
      hooks?: { stop?: { command?: string }[] };
    };
    const stopCommands = hooks.hooks?.stop?.map((h) => h.command) ?? [];
    expect(stopCommands).toContain("hooks/user-stop.sh");
    expect(stopCommands).toContain("hooks/goal-stop.sh");
    expect(stopCommands).not.toContain("hooks/goal-old.sh");
    expect(existsSync(path.join(fakeCursorHome, "hooks/user-stop.sh"))).toBe(true);
    expect(existsSync(path.join(fakeCursorHome, "hooks/goal-stop.sh"))).toBe(true);
    expect(existsSync(path.join(fakeCursorHome, "hooks/goal-old.sh"))).toBe(false);
  });
});
