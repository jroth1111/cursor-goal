import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { startCompileWatch, stopCompileWatch } from "../../src/lib/compile-watch.js";

function waitForCompileLog(logs: string[], timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const joined = logs.join("\n");
      if (/recompiled GOAL\.md|lock timeout/i.test(joined)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`compile watch did not report within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe("I99 compile watch lock discipline", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;
  let restoreConsole: () => void;

  afterEach(async () => {
    stopCompileWatch();
    restoreConsole?.();
    restore?.();
    await cleanup?.();
  });

  it("recompiles GOAL.md without nesting the goal-dir lock", async () => {
    const p = await mkGitProject("i99-compile-watch");
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

    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    restoreConsole = () => {
      console.error = originalError;
    };

    startCompileWatch(p.dir);
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
y
## Checks
- \`true\`
`,
      "utf8",
    );

    await waitForCompileLog(logs);
    const joined = logs.join("\n");
    expect(joined).toMatch(/recompiled GOAL\.md/);
    expect(joined).not.toMatch(/lock timeout/i);
  });
});
