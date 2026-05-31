import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I132 dispatch mode argument strictness", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects verification-only dispatch flags before normal dispatch output", async () => {
    const p = await mkGitProject("i132-dispatch-mode");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const cases = [
      {
        args: ["dispatch", "--unit", "u1"],
        error: /dispatch --unit requires --verify/,
      },
      {
        args: ["dispatch", "--spawn"],
        error: /dispatch --spawn requires --verify/,
      },
    ];

    for (const c of cases) {
      const r = spawnSync("node", [cli, ...c.args], {
        cwd: p.dir,
        encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
      });

      expect(r.status, c.args.join(" ")).not.toBe(0);
      expect(r.stderr, c.args.join(" ")).toMatch(c.error);
      expect(r.stdout, c.args.join(" ")).not.toMatch(/No open work units|Task prompt/);
    }
  });
});
