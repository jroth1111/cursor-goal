import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { dispatchQueuePath, syncDispatchQueueHeadIndex } from "../../src/lib/dispatch-queue.js";

describe("I72 dispatch queue head_index lock discipline", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    restore = undefined;
    cleanup = undefined;
  });

  it("does not update dispatch-queue.json while the goal-dir lock is held", async () => {
    const p = await mkGitProject("i72-lock");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal/.lock"), { recursive: true });
    await writeFile(
      dispatchQueuePath(p.dir),
      `${JSON.stringify(
        {
          head_index: 0,
          items: [
            { order: 0, unit_id: "a", title: "A", scope: ["a/"], acceptance: ["true"] },
            { order: 1, unit_id: "b", title: "B", scope: ["b/"], acceptance: ["true"] },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(syncDispatchQueueHeadIndex(p.dir, 1)).rejects.toThrow(/lock timeout/i);
    const queue = JSON.parse(await readFile(dispatchQueuePath(p.dir), "utf8")) as { head_index: number };
    expect(queue.head_index).toBe(0);
  });
});
