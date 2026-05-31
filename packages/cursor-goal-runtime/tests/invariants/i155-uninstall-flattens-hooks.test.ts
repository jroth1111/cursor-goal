import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I155 uninstall flattens legacy nested hooks", () => {
  let fakeCursorHome: string;
  let fakeHome: string;

  afterEach(() => {
    rmSync(fakeCursorHome, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("removes goal hook entries from legacy hooks.hooks configs while preserving user hooks", async () => {
    fakeCursorHome = path.join(os.tmpdir(), `i155-cursor-${Date.now()}`);
    fakeHome = path.join(os.tmpdir(), `i155-home-${Date.now()}`);
    await mkdir(path.join(fakeCursorHome, "hooks"), { recursive: true });
    await writeFile(
      path.join(fakeCursorHome, "hooks.json"),
      `${JSON.stringify(
        {
          version: 1,
          hooks: {
            version: 1,
            hooks: {
              stop: [
                { command: "hooks/user-stop.sh" },
                { command: "hooks/goal-stop.sh", loop_limit: 40 },
              ],
              preToolUse: [{ command: "hooks/goal-pre-tool.sh" }],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const script = path.resolve(import.meta.dirname, "../../../../scripts/uninstall-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../");
    const r = spawnSync("bash", [script], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CURSOR_HOME: fakeCursorHome, HOME: fakeHome },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const hooks = JSON.parse(await readFile(path.join(fakeCursorHome, "hooks.json"), "utf8")) as {
      hooks?: Record<string, { command?: string }[]>;
    };
    expect(hooks.hooks?.stop?.map((h) => h.command)).toEqual(["hooks/user-stop.sh"]);
    expect(hooks.hooks?.preToolUse).toBeUndefined();
    expect((hooks.hooks as unknown as { hooks?: unknown })?.hooks).toBeUndefined();
  });
});
