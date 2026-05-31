import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I128 read-only operator strict args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects unsupported read-only operator args before falling through to normal output", async () => {
    const p = await mkGitProject("i128-readonly-operator");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const cases = [
      ["next", "--jsoon"],
      ["explain", "--jsoon"],
      ["status", "--jsoon"],
      ["logs", "--tail"],
      ["next", "--conversation"],
    ];

    for (const args of cases) {
      const r = spawnSync("node", [cli, ...args], {
        cwd: p.dir,
        encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
      });

      expect(r.status, args.join(" ")).not.toBe(0);
      expect(r.stderr, args.join(" ")).toMatch(/Unknown option|Missing value/);
      expect(r.stdout, args.join(" ")).not.toMatch(/GOAL\.md missing|\[\]/);
    }
  });
});
