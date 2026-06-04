import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writePassingUnitEvidence } from "../helpers/release-ready.js";

describe("I220 units done requires adversarial verdict", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects units done without VERDICT when verified_by is set", async () => {
    const p = await mkGitProject("i220");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await writeFile(path.join(p.dir, "pkg", "ok.txt"), "ok\n", "utf8");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### u1
Unit
- scope: \`pkg/\`
- acceptance: \`test -f pkg/ok.txt\`
- verified_by: verifier
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writePassingUnitEvidence(p.dir, "u1");
    const deliverableDir = path.join(p.dir, ".cursor/goal/outputs/u1");
    await mkdir(deliverableDir, { recursive: true });
    await writeFile(path.join(deliverableDir, "deliverable.md"), "# deliverable\n", "utf8");

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "units", "done", "u1"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/dispatch --verify/i);
  });
});
