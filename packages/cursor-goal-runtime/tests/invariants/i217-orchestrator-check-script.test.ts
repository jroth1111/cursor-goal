import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I217 orchestrator check script", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("exits 0 when marker absent", async () => {
    const p = await mkGitProject("i217-orch-absent");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const script = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/goal/scripts/check-orchestrator-status.mjs",
    );
    const r = spawnSync("node", [script], { cwd: p.dir, encoding: "utf8" });
    expect(r.status).toBe(0);
  });

  it("exits 1 with parseable output when incomplete", async () => {
    const p = await mkGitProject("i217-orch-incomplete");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const auditDir = ".cursor-audit/test-orch";
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/orchestrator.json"),
      JSON.stringify({
        audit_dir: auditDir,
        marker: "ORCHESTRATOR_ACTIVE",
        status_file: "ORCHESTRATOR_STATUS.json",
        master_status: "MASTER_STATUS.md",
        final_report: "FINAL_REPORT.md",
        required_done: ["Phase A"],
        check_command: "node .cursor/goal/scripts/check-orchestrator-status.mjs",
      }),
      "utf8",
    );
    await mkdir(path.join(p.dir, auditDir), { recursive: true });
    await writeFile(path.join(p.dir, auditDir, "ORCHESTRATOR_ACTIVE"), "1\n", "utf8");
    await writeFile(
      path.join(p.dir, auditDir, "MASTER_STATUS.md"),
      "## Phase progress\n\n| Phase | Status | Notes |\n|-------|--------|-------|\n| Phase A | OPEN | |\n",
      "utf8",
    );

    const script = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/goal/scripts/check-orchestrator-status.mjs",
    );
    const r = spawnSync("node", [script], { cwd: p.dir, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr ?? r.stdout).toMatch(/must be `DONE`|not complete/i);
  });
});
