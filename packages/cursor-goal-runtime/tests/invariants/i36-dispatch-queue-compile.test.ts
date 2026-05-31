import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { validateArtifact } from "../../src/compile/schemas.js";
import { dispatchQueuePath } from "../../src/lib/dispatch-queue.js";

describe("I36 compile emits dispatch-queue.json", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("writes schema-valid dispatch-queue in work unit order", async () => {
    const p = await mkGitProject("i36");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Ship modules

## Work units

### mod-a
Module A
- \`pkg/a/\`

### mod-b
Module B
- \`pkg/b/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    expect(existsSync(dispatchQueuePath(p.dir))).toBe(true);
    const { readFile } = await import("node:fs/promises");
    const queue = JSON.parse(await readFile(dispatchQueuePath(p.dir), "utf8"));
    expect((await validateArtifact("dispatch-queue", queue)).ok).toBe(true);
    expect(queue.items.map((i: { unit_id: string }) => i.unit_id)).toEqual(["mod-a", "mod-b"]);
    expect(queue.head_index).toBe(0);
  });
});
