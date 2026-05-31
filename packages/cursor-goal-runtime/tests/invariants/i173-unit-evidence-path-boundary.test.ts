import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { checkUnitCompletionEvidence } from "../../src/lib/unit-evidence.js";
import type { WorkUnitCompiled } from "../../src/compile/compile-v2.js";

describe("I173 unit evidence path boundary", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("rejects work-unit evidence paths that escape the canonical evidence directory", async () => {
    const p = await mkGitProject("i173-runtime-evidence-path");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/outside.jsonl"),
      `${JSON.stringify({
        evidence_version: 1,
        at: new Date().toISOString(),
        work_unit_id: "unit-a",
        acceptance_ok: true,
        status: "completed",
      })}\n`,
      "utf8",
    );

    const unit: WorkUnitCompiled = {
      id: "unit-a",
      title: "Unit A",
      scope: ["src/"],
      acceptance: ["true"],
      status: "pending",
      subagent_id: null,
      evidence_path: "../outside.jsonl",
    };

    const result = await checkUnitCompletionEvidence(p.dir, unit);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/evidence_path|evidence\/units\/unit-a\.jsonl/);
  });

  it("supervisor dry-run blocks units whose evidence path escapes the canonical evidence directory", async () => {
    const p = await mkGitProject("i173-supervisor-evidence-path");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/hooks"), { recursive: true });
    await writeFile(path.join(p.dir, ".cursor/hooks/goal-stop.sh"), "#!/usr/bin/env bash\n", "utf8");
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/work-units.json"),
      `${JSON.stringify({
        units: [
          {
            id: "unit-a",
            title: "Unit A",
            scope: ["src/"],
            acceptance: ["true"],
            status: "pending",
            subagent_id: null,
            evidence_path: "../outside.jsonl",
          },
        ],
      })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/outside.jsonl"),
      `${JSON.stringify({
        evidence_version: 1,
        at: new Date().toISOString(),
        work_unit_id: "unit-a",
        acceptance_ok: true,
        status: "completed",
      })}\n`,
      "utf8",
    );

    const supervisor = path.resolve(import.meta.dirname, "../../../../supervisor/run-goal.mjs");
    const r = spawnSync("node", [supervisor, "--dry-run", "--units-only"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).toMatch(/Blocked unit: unit-a/);
    expect(out).toMatch(/evidence_path|evidence\/units\/unit-a\.jsonl/);
    expect(out).not.toMatch(/Dispatch unit: unit-a/);
  });
});
