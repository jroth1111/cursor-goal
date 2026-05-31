import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { checkUnitCompletionEvidence } from "../../src/lib/unit-evidence.js";
import { readWorkUnits } from "../../src/lib/work-units.js";

describe("I89 strict unit evidence schema", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function setupProject(): Promise<string> {
    const p = await mkGitProject("i89");
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
    return p.dir;
  }

  it("rejects legacy evidence without evidence_version", async () => {
    const dir = await setupProject();
    const wu = await readWorkUnits(dir);
    const unit = wu!.units[0];
    const evidenceDir = path.join(dir, ".cursor/goal/evidence/units");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      path.join(evidenceDir, "unit-a.jsonl"),
      JSON.stringify({ work_unit_id: "unit-a", ok: true, status: "passed" }) + "\n",
      "utf8",
    );
    const r = await checkUnitCompletionEvidence(dir, unit);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/evidence_version/i);
  });

  it("accepts v1 evidence with acceptance_ok and success status", async () => {
    const dir = await setupProject();
    const wu = await readWorkUnits(dir);
    const unit = wu!.units[0];
    const evidenceDir = path.join(dir, ".cursor/goal/evidence/units");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      path.join(evidenceDir, "unit-a.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        evidence_version: 1,
        work_unit_id: "unit-a",
        acceptance_ok: true,
        subagent_status: "completed",
        status: "completed",
      }) + "\n",
      "utf8",
    );
    const r = await checkUnitCompletionEvidence(dir, unit);
    expect(r.ok).toBe(true);
  });
});
