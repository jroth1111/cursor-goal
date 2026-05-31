import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { execMinimalStop } from "../hooks/exec-hook.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I08 disposition on budget", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("runtime writes DISPOSITION near loop limit", async () => {
    const p = await mkGitProject("i08");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: 5 }),
      "utf8",
    );
    await seedReleaseReady(p.dir);
    // Disposition uses max(goal blocked attempts, Cursor stop index); cursor 3 hits limit 5 budget.
    const r = await runStopVerifier({ status: "completed", loop_count: 3 });
    expect(r.kind).toBe("disposition");
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/DISPOSITION.json"))).toBe(true);
  });

  it("minimal hook writes DISPOSITION near loop limit", async () => {
    const p = await mkGitProject("i08b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    execMinimalStop(p.dir, { status: "completed", loop_count: 38 });
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/DISPOSITION.json"))).toBe(true);
  });
});
