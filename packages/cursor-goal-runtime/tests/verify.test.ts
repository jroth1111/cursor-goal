import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runStopVerifier } from "../src/lib/verify.js";
import { compileGoal } from "../src/lib/compile-goal.js";
import { seedReleaseReady } from "./helpers/release-ready.js";

async function mkProject(): Promise<string> {
  const dir = path.join(os.tmpdir(), `cgr-v-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(path.join(dir, ".cursor", "goal", "passports"), { recursive: true });
  return dir;
}

describe("runStopVerifier", () => {
  let dir: string;
  let prev: string | undefined;

  beforeEach(async () => {
    dir = await mkProject();
    prev = process.env.CURSOR_PROJECT_DIR;
    process.env.CURSOR_PROJECT_DIR = dir;
  });

  afterEach(async () => {
    process.env.CURSOR_PROJECT_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects release when ## Checks is empty", async () => {
    await writeFile(
      path.join(dir, "GOAL.md"),
      `## Checks

## Forbidden proxies
`,
      "utf8",
    );
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    if (r.kind === "continue") {
      expect(r.message).toMatch(/empty/i);
    }
  });

  it("releases when checks pass", async () => {
    await writeFile(
      path.join(dir, "GOAL.md"),
      `## Goal
Enough goal text here
## Checks
- \`true\`
`,
      "utf8",
    );
    await seedReleaseReady(dir);
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("release");
  });

  it("compile leaves scope disabled when no ## Scope paths", async () => {
    await writeFile(
      path.join(dir, "GOAL.md"),
      `## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoal();
    const scope = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(dir, ".cursor/goal/scope.json"), "utf8"),
      ),
    );
    expect(scope.enforce).toBe(false);
    expect(scope.paths).toEqual([]);
  });
});
