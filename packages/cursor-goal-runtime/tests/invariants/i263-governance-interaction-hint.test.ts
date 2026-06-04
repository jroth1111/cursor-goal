import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { resolveEffectiveMode } from "../../src/lib/prompt-triage.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { formatGovernedSubmitHeader } from "../../src/lib/governed-submit-header.js";
import { buildDoctorReport } from "../../src/lib/doctor.js";

describe("I263 governance interaction mode hint", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("returns delivery hint for explicit governed prompts", async () => {
    const p = await mkGitProject("i263-delivery-hint");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const mode = await resolveEffectiveMode(p.dir, "/goal continue", "a263");
    expect(mode.mode).toBe("governed");
    expect(mode.interactionModeHint).toBe("delivery");
  });

  it("returns chat hint for read-only prompts", async () => {
    const p = await mkGitProject("i263-chat-hint");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const mode = await resolveEffectiveMode(p.dir, "review only, do not edit", "a263");
    expect(mode.mode).toBe("chat");
    expect(mode.interactionModeHint).toBe("chat");
  });

  it("mode governed refreshes session-mode with delivery hint", async () => {
    const p = await mkGitProject("i263-mode-governed-hint");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const r = spawnSync("node", [cli, "mode", "governed"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const session = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/session-mode.json"), "utf8"),
    );
    expect(session.mode).toBe("governed");
    expect(session.effective_mode).toBe("governed");
    expect(session.interaction_mode_hint).toBe("delivery");
  });

  it("governed submit header emits effective mode and interaction hint", async () => {
    const p = await mkGitProject("i263-mode-header");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "governed", "cli", "delivery");

    const header = await formatGovernedSubmitHeader(p.dir);
    expect(header).toContain("Mode: effective=governed hint=delivery");
  });

  it("doctor warns when authoritative mode and interaction hint diverge", async () => {
    const p = await mkGitProject("i263-mode-divergence");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, ".cursor/goal/session-mode.json"),
      JSON.stringify({
        mode: "governed",
        effective_mode: "governed",
        source: "cli",
        interaction_mode_hint: "chat",
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    const report = await buildDoctorReport(p.dir);
    expect(report.issues.some((i) => i.message.includes("interaction_mode_hint=chat"))).toBe(true);
  });
});
