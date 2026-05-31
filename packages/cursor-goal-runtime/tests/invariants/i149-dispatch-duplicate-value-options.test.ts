import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { unitVerifierResultPath } from "../../src/lib/adversarial-paths.js";

describe("I149 dispatch duplicate value options", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("rejects duplicate dispatch value options before recording verifier state", async () => {
    const p = await mkGitProject("i149-dispatch-duplicate-values");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Work units

### u1
Unit 1
- scope: \`src/\`
- verified_by: verifier

### u2
Unit 2
- scope: \`src/\`
- verified_by: verifier

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const responsePath = path.join(p.dir, "verifier-response.txt");
    await writeFile(responsePath, "VERDICT: PASS\n", "utf8");
    await mkdir(path.dirname(unitVerifierResultPath(p.dir, "u1")), { recursive: true });

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync(
      "node",
      [
        cli,
        "dispatch",
        "--record-response",
        "u1",
        "--from",
        responsePath,
        "--record-response",
        "u2",
      ],
      {
        cwd: p.dir,
        encoding: "utf8",
        env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
      },
    );

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Duplicate option: --record-response/);
    expect(existsSync(unitVerifierResultPath(p.dir, "u1"))).toBe(false);
    expect(existsSync(unitVerifierResultPath(p.dir, "u2"))).toBe(false);
  });
});
