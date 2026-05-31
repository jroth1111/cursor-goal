import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runStopVerifier } from "../../src/lib/verify.js";

describe("I174 done work units require evidence", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("blocks parent RELEASE when done work-unit status lacks acceptable evidence", async () => {
    const p = await mkGitProject("i174-done-without-evidence");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### unit-a
Task A
- \`src/a/\`
- acceptance: \`true\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "VERIFY" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/discovery.json"),
      JSON.stringify({ completed: true, notes: "ok" }),
      "utf8",
    );
    const workUnitsPath = path.join(p.dir, ".cursor/goal/work-units.json");
    const workUnits = JSON.parse(await readFile(workUnitsPath, "utf8")) as {
      units: Array<{ status: string }>;
    };
    workUnits.units[0].status = "done";
    await writeFile(workUnitsPath, `${JSON.stringify(workUnits, null, 2)}\n`, "utf8");

    const result = await runStopVerifier({ status: "completed", loop_count: 0 });

    expect(result.kind).toBe("continue");
    if (result.kind === "continue") {
      expect(result.message).toMatch(/unit-a|evidence/i);
    }
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(false);
  });
});
