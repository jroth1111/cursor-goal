import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runDoctor } from "../../src/lib/doctor.js";

describe("I271 doctor warns when Claude settings also define cursor-goal hooks", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("reports project .claude/settings.json cursor-goal hook conflicts", async () => {
    const p = await mkGitProject("i271-claude-hooks");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    await mkdir(path.join(p.dir, ".cursor"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/hooks.json"),
      JSON.stringify({ version: 1, hooks: { stop: [{ command: "hooks/goal-stop.sh" }] } }),
      "utf8",
    );

    await mkdir(path.join(p.dir, ".claude"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".claude/settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [{ type: "command", command: "hooks/goal-stop.sh" }],
            },
          ],
        },
      }),
      "utf8",
    );

    const issues = await runDoctor(p.dir);
    const text = issues.map((issue) => issue.message).join("\n");
    expect(text).toMatch(/\.claude\/settings\.json/i);
    expect(text).toMatch(/cursor-goal hooks/i);
    expect(text).toMatch(/Cursor translates Claude/i);
  });
});
