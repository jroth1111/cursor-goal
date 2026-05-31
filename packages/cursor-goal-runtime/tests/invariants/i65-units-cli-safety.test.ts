import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { readWorkUnits } from "../../src/lib/work-units.js";

describe("I65 units CLI safety", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function setupProject(prefix: string): Promise<string> {
    const p = await mkGitProject(prefix);
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

  it("units done --help prints usage and does not mutate work units", async () => {
    const dir = await setupProject("i65-help");
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const r = spawnSync("node", [cli, "units", "done", "--help"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage: cursor-goal units/);
    const wu = await readWorkUnits(dir);
    expect(wu?.units.find((u) => u.id === "unit-a")?.status).toBe("pending");
  });

  it("units done rejects missing or blocked evidence", async () => {
    const dir = await setupProject("i65-blocked");
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const missing = spawnSync("node", [cli, "units", "done", "unit-a"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
    expect(missing.status).toBe(1);
    expect(`${missing.stdout}${missing.stderr}`).toMatch(/evidence/i);

    const evidenceDir = path.join(dir, ".cursor/goal/evidence/units");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      path.join(evidenceDir, "unit-a.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        work_unit_id: "unit-a",
        ok: false,
        blocked: true,
        blocker: "precondition failed",
        status: "blocked",
      }) + "\n",
      "utf8",
    );

    const blocked = spawnSync("node", [cli, "units", "done", "unit-a"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });
    expect(blocked.status).toBe(1);
    expect(`${blocked.stdout}${blocked.stderr}`).toMatch(/blocked|precondition failed/i);
    const wu = await readWorkUnits(dir);
    expect(wu?.units.find((u) => u.id === "unit-a")?.status).toBe("pending");
  });

  it("units done accepts non-blocked evidence", async () => {
    const dir = await setupProject("i65-ok");
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
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
        status: "passed",
      }) + "\n",
      "utf8",
    );

    const r = spawnSync("node", [cli, "units", "done", "unit-a"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });

    expect(r.status).toBe(0);
    const wu = await readWorkUnits(dir);
    expect(wu?.units.find((u) => u.id === "unit-a")?.status).toBe("done");
  });
});
