import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runDoctor } from "../../src/lib/doctor.js";

describe("I257 doctor audits Cursor-native hook semantics", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("warns on duplicate cursor-goal stop hooks and too-low stop timeout", async () => {
    const p = await mkGitProject("i257");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/hooks.json"),
      JSON.stringify({
        hooks: {
          stop: [
            { command: ".cursor/hooks/goal-stop.sh", timeout: 120 },
            { command: ".cursor/hooks/goal-stop.sh", timeout: 600 },
          ],
          preCompact: [{ command: ".cursor/hooks/goal-precompact.sh" }],
        },
      }),
      "utf8",
    );

    const issues = await runDoctor(p.dir);
    const text = issues.map((i) => i.message).join("\n");
    expect(text).toMatch(/duplicate cursor-goal stop hook/i);
    expect(text).toMatch(/stop\.timeout.*600/i);
    expect(text).toMatch(/preCompact.*user_message/i);
  });
});
