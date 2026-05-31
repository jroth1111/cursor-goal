import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { readWorkUnits } from "../../src/lib/work-units.js";

describe("I112 units strict args", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects extra units done args before marking a work unit done", async () => {
    const p = await mkGitProject("i112-units");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### unit-a
A
- \`scripts/a.py\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const evidenceDir = path.join(p.dir, ".cursor/goal/evidence/units");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      path.join(evidenceDir, "unit-a.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        evidence_version: 1,
        work_unit_id: "unit-a",
        acceptance_ok: true,
        subagent_status: "completed",
        status: "passed",
      }) + "\n",
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "units", "done", "unit-a", "--done"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --done/);
    const wu = await readWorkUnits(p.dir);
    expect(wu?.units.find((u) => u.id === "unit-a")?.status).toBe("pending");
  });
});
