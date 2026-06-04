import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { readDispatchQueue } from "../../src/lib/dispatch-queue.js";
import { markUnitDoneWithEvidence } from "../helpers/release-ready.js";

describe("I234 compile syncs dispatch queue head to first open unit", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("sets head_index to first pending unit after compile when prior unit is done", async () => {
    const p = await mkGitProject("i234");
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
    await markUnitDoneWithEvidence("mod-a", p.dir);

    await writeFile(
      path.join(p.dir, ".cursor/goal/dispatch-queue.json"),
      JSON.stringify({
        items: [
          { order: 0, unit_id: "mod-a", title: "A", scope: ["pkg/a/"], acceptance: ["true"] },
          { order: 1, unit_id: "mod-b", title: "B", scope: ["pkg/b/"], acceptance: ["true"] },
        ],
        head_index: 0,
      }),
      "utf8",
    );

    await compileGoalV2(p.dir);
    const queue = await readDispatchQueue(p.dir);
    expect(queue?.head_index).toBe(1);
    expect(queue?.items[queue.head_index]?.unit_id).toBe("mod-b");
  });
});
