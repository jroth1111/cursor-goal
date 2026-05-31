import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { readLoopLimit } from "../../src/lib/loop-limit.js";
import { execCoreHookBare } from "../hooks/exec-hook.js";

describe("I172 nested hooks loop limit", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  async function seedNestedHooks(loopLimit: number): Promise<string> {
    const p = await mkGitProject("i172-nested-hooks-loop-limit");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/hooks.json"),
      `${JSON.stringify(
        {
          version: 1,
          hooks: {
            version: 1,
            hooks: {
              stop: [{ command: "hooks/goal-stop.sh", loop_limit: loopLimit }],
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return p.dir;
  }

  it("runtime loop-limit reads legacy nested hooks.hooks stop entries", async () => {
    const dir = await seedNestedHooks(7);

    await expect(readLoopLimit(dir)).resolves.toBe(7);
  });

  it("minimal sessionStart seeds manifest loop_limit from legacy nested hooks.hooks", async () => {
    const dir = await seedNestedHooks(7);

    const r = execCoreHookBare(dir, "sessionStart", {});

    expect(r.exitCode, r.raw).toBe(0);
    const manifest = JSON.parse(
      await readFile(path.join(dir, ".cursor/goal/manifest.json"), "utf8"),
    ) as { loop_limit?: number };
    expect(manifest.loop_limit).toBe(7);
  });
});
