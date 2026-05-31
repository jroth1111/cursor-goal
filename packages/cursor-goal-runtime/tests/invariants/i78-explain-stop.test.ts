import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { buildExplainReport, formatExplainReport } from "../../src/lib/explain-stop.js";
import { appendStopTrace } from "../../src/lib/stop-trace.js";
import { seedReleaseReady } from "../helpers/release-ready.js";

describe("I78 explain stop diagnostics", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("includes failing check command and L3 label", async () => {
    const p = await mkGitProject("i78");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    const report = await buildExplainReport({ status: "completed" });
    const text = formatExplainReport(report);
    expect(report.level_failed).toBe("L3");
    expect(report.check_results.some((c) => c.cmd === "false" && !c.ok)).toBe(true);
    expect(text).toMatch(/FAIL false/);
  });

  it("includes last stop-trace entry when present", async () => {
    const p = await mkGitProject("i78-trace");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await appendStopTrace(p.dir, {
      at: "2026-05-30T12:00:00.000Z",
      level_failed: "L3",
      failures: ["npm test"],
      pipeline_result: "disposition",
    });
    const report = await buildExplainReport({ status: "completed" });
    expect(report.last_stop_trace?.pipeline_result).toBe("disposition");
    expect(report.last_stop_trace?.failures).toContain("npm test");
    const text = formatExplainReport(report);
    expect(text).toMatch(/Last stop:/);
    expect(text).toMatch(/disposition/);
  });
});
