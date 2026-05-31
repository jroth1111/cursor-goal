import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { rmSync } from "node:fs";

describe("I48 cgr_resolve_runtime finds global install path", () => {
  let fakeHome: string;
  let prevHome: string | undefined;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("resolves ~/.cursor/cursor-goal-runtime", async () => {
    fakeHome = path.join(os.tmpdir(), `i48-home-${Date.now()}`);
    const globalRt = path.join(fakeHome, ".cursor/cursor-goal-runtime/dist");
    await mkdir(globalRt, { recursive: true });
    await writeFile(path.join(globalRt, "hook-stop.mjs"), "export {};\n", "utf8");

    prevHome = process.env.HOME;
    process.env.HOME = fakeHome;

    const lib = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/hooks/_cgr-lib.sh",
    );
    const env = { ...process.env, HOME: fakeHome };
    delete env.CURSOR_GOAL_RUNTIME;
    const r = spawnSync(
      "bash",
      ["-c", `source "$1" && cgr_resolve_runtime`, "bash", lib],
      {
        cwd: os.tmpdir(),
        encoding: "utf8",
        env,
      },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(path.join(fakeHome, ".cursor/cursor-goal-runtime"));
  });
});
