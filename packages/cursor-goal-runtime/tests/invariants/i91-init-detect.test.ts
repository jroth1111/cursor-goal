import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { readFile } from "node:fs/promises";

describe("I91 init --detect", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("writes npm checks when package.json has test script", async () => {
    const p = await mkGitProject("i91");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." } }, null, 2),
      "utf8",
    );
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "init", "--detect"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const goal = await readFile(path.join(p.dir, "GOAL.md"), "utf8");
    expect(goal).toMatch(/npm test/);
  });
});
