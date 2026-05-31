import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I153 operator duplicate conversation option", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects duplicate read-only operator conversation selectors before normal output", async () => {
    const p = await mkGitProject("i153-operator-duplicate-conversation");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const cases = [
      ["next", "--json", "--conversation", "agent-a", "--conversation", "agent-b"],
      ["explain", "--json", "--conversation", "agent-a", "--conversation", "agent-b"],
      ["status", "--json", "--conversation", "agent-a", "--conversation", "agent-b"],
    ];

    for (const args of cases) {
      const r = spawnSync("node", [cli, ...args], {
        cwd: p.dir,
        encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
      });

      expect(r.status, args.join(" ")).not.toBe(0);
      expect(r.stderr, args.join(" ")).toMatch(/Duplicate option: --conversation/);
      expect(r.stdout, args.join(" ")).not.toMatch(/"blocked"|"status"|No blockers/);
    }
  });
});
