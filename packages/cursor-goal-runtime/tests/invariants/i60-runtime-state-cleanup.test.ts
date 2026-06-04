import { describe, it, expect, afterEach } from "vitest";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import {
  formatDispositionMessage,
  formatFollowupMessage,
} from "../../src/lib/runtime-state.js";
import {
  sessionEndMarkerPath,
  writeAgentDisposition,
} from "../../src/lib/disposition.js";
import { dispositionWaivesUnits } from "../../src/lib/work-units.js";
import { repoDispositionManifestPath } from "../../src/lib/disposition.js";

describe("I60 runtime-state cleanup", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("formatDispositionMessage points at per-agent DISPOSITION.md", () => {
    const msg = formatDispositionMessage(
      {
        mode: "runtime",
        loop_count: 3,
        loop_limit: 40,
        phase: "VERIFY",
        blocked: true,
        blockers: ["x"],
        next_action: null,
        last_check_fail: null,
        updated_at: new Date().toISOString(),
      },
      38,
      5,
      "agent-xyz",
    );
    expect(msg).toContain(".cursor/goal/agents/agent-xyz/DISPOSITION.md");
    expect(msg).not.toContain("passports/DISPOSITION.md");
  });

  it("formatFollowupMessage uses concrete agent path", () => {
    const msg = formatFollowupMessage(
      {
        mode: "runtime",
        loop_count: 1,
        loop_limit: 40,
        phase: "VERIFY",
        blocked: true,
        blockers: [],
        next_action: null,
        last_check_fail: null,
        updated_at: new Date().toISOString(),
      },
      null,
      null,
      "conv-1",
    );
    expect(msg).toContain("agents/conv-1/runtime-state.json");
    expect(msg).toContain("cursor-goal next --conversation conv-1");
  });

  it("dispositionWaivesUnits reads per-agent waive flag", async () => {
    const p = await mkGitProject("i60-waive");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeAgentDisposition(p.dir, "agent-a", {
      status: "DISPOSITION",
      recoverable: true,
      failed: [],
      loop_count: 10,
      agent_id: "agent-a",
      at: new Date().toISOString(),
      waive_work_units: true,
    });
    expect(await dispositionWaivesUnits(p.dir, "agent-a")).toBe(true);
    expect(await dispositionWaivesUnits(p.dir, "agent-b")).toBe(false);
  });

  it("RELEASE uses one lock for reset and agent write", async () => {
    const p = await mkGitProject("i60-release-lock");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    const { compileGoalV2 } = await import("../../src/compile/compile-v2.js");
    await compileGoalV2(p.dir);
    const { seedReleaseReady } = await import("../helpers/release-ready.js");
    await seedReleaseReady(p.dir);
    const { runStopVerifier } = await import("../../src/lib/verify.js");
    const { readAgentRuntimeState } = await import("../../src/lib/agent-runtime-state.js");
    await runStopVerifier({ status: "completed", loop_count: 0, conversation_id: "rel-a" });
    const agent = await readAgentRuntimeState(p.dir, "rel-a");
    expect(agent?.blocked).toBe(false);
    expect(agent?.loop_count).toBe(0);
  });

  it("disposition file exists after blocked stop in same pass as agent state", async () => {
    const p = await mkGitProject("i60-disp-lock");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: 40 }),
      "utf8",
    );
    const { compileGoalV2 } = await import("../../src/compile/compile-v2.js");
    await compileGoalV2(p.dir);
    const { runStopVerifier } = await import("../../src/lib/verify.js");
    const { hasAgentDisposition } = await import("../../src/lib/disposition.js");
    const { readAgentRuntimeState } = await import("../../src/lib/agent-runtime-state.js");
    await runStopVerifier({
      status: "completed",
      loop_count: 38,
      conversation_id: "disp-lock",
    });
    expect(await hasAgentDisposition(p.dir, "disp-lock")).toBe(true);
    expect((await readAgentRuntimeState(p.dir, "disp-lock"))?.blocked).toBe(true);
  });

  it("session end writes SESSION_END not repo DISPOSITION manifest as disposition record", async () => {
    const p = await mkGitProject("i60-session");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const legacy = repoDispositionManifestPath(p.dir);
    await unlink(legacy).catch(() => undefined);
    await writeFile(
      sessionEndMarkerPath(p.dir),
      JSON.stringify({ status: "SESSION_END", at: new Date().toISOString() }),
      "utf8",
    );
    expect(existsSync(sessionEndMarkerPath(p.dir))).toBe(true);
    const raw = await import("../../src/lib/paths.js").then((m) =>
      m.readJson<{ status?: string; agents_in_disposition?: string[] }>(legacy),
    );
    expect(raw?.agents_in_disposition).toBeUndefined();
  });

  it("writeJson creates parent directories for session lifecycle markers", async () => {
    const p = await mkGitProject("i60-write-json-parent");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const { writeJson } = await import("../../src/lib/paths.js");
    const marker = path.join(p.dir, ".cursor/goal/passports/SESSION_END.json");

    await writeJson(marker, { status: "SESSION_END" });

    expect(JSON.parse(await readFile(marker, "utf8")).status).toBe("SESSION_END");
  });
});
