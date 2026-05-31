import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { rmSync } from "node:fs";

describe("I49 install-global dry-run produces manifest and hooks merge", () => {
  let fakeCursorHome: string;

  afterEach(() => {
    rmSync(fakeCursorHome, { recursive: true, force: true });
  });

  it("writes manifest and merges hooks.json without copying runtime", async () => {
    fakeCursorHome = path.join(os.tmpdir(), `i49-cursor-${Date.now()}`);
    const script = path.resolve(import.meta.dirname, "../../../../scripts/install-global.sh");
    const repoRoot = path.resolve(import.meta.dirname, "../../../../../");

    const r = spawnSync("bash", [script, "--skip-build", "--dry-run"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, CURSOR_HOME: fakeCursorHome },
    });
    expect(r.status).toBe(0);

    const manifest = path.join(fakeCursorHome, "cursor-goal/install-manifest.json");
    expect(existsSync(manifest)).toBe(true);
    const parsed = JSON.parse(await readFile(manifest, "utf8")) as { dry_run?: boolean };
    expect(parsed.dry_run).toBe(true);

    const hooksJson = path.join(fakeCursorHome, "hooks.json");
    expect(existsSync(hooksJson)).toBe(true);
    const hooks = JSON.parse(await readFile(hooksJson, "utf8")) as {
      hooks?: { stop?: { command?: string }[] };
    };
    expect(hooks.hooks?.stop?.some((h) => h.command?.includes("goal-stop"))).toBe(true);
  });
});
