import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";

async function releaseReady(dir: string): Promise<void> {
  await writeFile(
    path.join(dir, ".cursor/goal/trajectory.json"),
    JSON.stringify({ phase: "VERIFY" }),
    "utf8",
  );
  await writeFile(
    path.join(dir, ".cursor/goal/discovery.json"),
    JSON.stringify({ completed: true, notes: "ok" }),
    "utf8",
  );
}

describe("I21 missing trajectory blocks RELEASE", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("blocks release when trajectory.json missing", async () => {
    const p = await mkGitProject("i21");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nlong enough goal\n## Checks\n- `true`\n",
      "utf8",
    );
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    expect(r.kind === "continue" && r.message).toMatch(/phase|DISCOVERY/i);
  });

  it("releases when trajectory VERIFY and discovery done", async () => {
    const p = await mkGitProject("i21b");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nlong enough goal\n## Checks\n- `true`\n",
      "utf8",
    );
    await releaseReady(p.dir);
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("release");
  });
});
