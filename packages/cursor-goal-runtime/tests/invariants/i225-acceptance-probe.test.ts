import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { buildOperatorSnapshot } from "../../src/lib/operator.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I225 acceptance probe snapshot", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;
  let prevProbe: string | undefined;

  afterEach(async () => {
    if (prevProbe === undefined) delete process.env.CURSOR_GOAL_ACCEPTANCE_PROBE;
    else process.env.CURSOR_GOAL_ACCEPTANCE_PROBE = prevProbe;
    restore?.();
    await cleanup?.();
  });

  it("writes snapshot on compile and exposes acceptance_preflight in next --json", async () => {
    prevProbe = process.env.CURSOR_GOAL_ACCEPTANCE_PROBE;
    process.env.CURSOR_GOAL_ACCEPTANCE_PROBE = "1";

    const p = await mkGitProject("i225");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await writeFile(path.join(p.dir, "pkg", "ok.txt"), "ok\n", "utf8");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### pkg-unit
Pkg
- scope: \`pkg/\`
- acceptance: \`test -f pkg/ok.txt\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await seedReleaseReady(p.dir);
    await compileGoalV2(p.dir);

    const snapPath = path.join(p.dir, ".cursor/goal/unit-acceptance-snapshot.json");
    const raw = await readFile(snapPath, "utf8");
    const snap = JSON.parse(raw) as { units: Array<{ unit_id: string; acceptance_ok: boolean }> };
    expect(snap.units.some((u) => u.unit_id === "pkg-unit" && u.acceptance_ok)).toBe(true);

    const op = await buildOperatorSnapshot(p.dir);
    expect("error" in op).toBe(false);
    if (!("error" in op)) {
      expect(op.acceptance_preflight?.["pkg-unit"]).toBe(true);
    }
  });
});
