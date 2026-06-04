import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";

describe("I256 stop records transcript-tail evidence", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("persists transcript tail metadata without embedding the full transcript", async () => {
    const p = await mkGitProject("i256");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `node -e \"process.exit(1)\"`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeSessionMode(p.dir, "governed", "triage");
    const transcriptDir = path.join(p.dir, ".cursor", "transcripts", "conv-a");
    await mkdir(transcriptDir, { recursive: true });
    const transcript = path.join(transcriptDir, "conv-a.jsonl");
    await writeFile(
      transcript,
      [
        JSON.stringify({ type: "user", text: "normal request" }),
        JSON.stringify({ type: "assistant", text: "[governance] stop_sig=abcdef123456 State: phase=VERIFY blocked=true" }),
        JSON.stringify({ type: "user", text: "very secret full prompt that must not be copied into stop trace" }),
      ].join("\n"),
      "utf8",
    );

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-stop.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({
        status: "completed",
        conversation_id: "conv-a",
        loop_count: 0,
        transcript_path: transcript,
      }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status, r.stderr).toBe(0);

    const trace = await readFile(path.join(p.dir, ".cursor/goal/stop-trace.jsonl"), "utf8");
    expect(trace).toContain('"transcript_tail"');
    expect(trace).toContain('"line_count":3');
    expect(trace).toContain('"prior_governance_followup":true');
    expect(trace).not.toContain("very secret full prompt");
  });
});
