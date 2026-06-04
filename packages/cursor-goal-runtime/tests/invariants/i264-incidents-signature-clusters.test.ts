import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { buildIncidentReport } from "../../src/lib/incidents.js";

describe("I264 incident signature clusters", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;
  let tempDir = "";
  let prevCursorHome: string | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    await rm(tempDir, { recursive: true, force: true });
    if (prevCursorHome === undefined) delete process.env.CURSOR_HOME;
    else process.env.CURSOR_HOME = prevCursorHome;
    cleanup = undefined;
    restore = undefined;
    tempDir = "";
    prevCursorHome = undefined;
  });

  it("emits stable signature clusters for transcript failures", async () => {
    const p = await mkGitProject("i264-incident-signatures");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    prevCursorHome = process.env.CURSOR_HOME;
    tempDir = path.join(os.tmpdir(), `i262-cursor-${process.pid}-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    const transcriptDir = path.join(cursorHome, "projects/test/agent-transcripts/session-a");
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      path.join(transcriptDir, "session-a.jsonl"),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        role: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: `cannot find module in ${p.dir}`,
            },
          ],
        },
      })}\n`,
      "utf8",
    );
    process.env.CURSOR_HOME = cursorHome;
    const report = await buildIncidentReport(p.dir, "today");
    expect(report.clusters.agent_transcript_failure).toBe(1);
    expect(report.signature_clusters?.["agent:module_not_found"]).toBe(1);
  });

  it("normalizes canonical signatures across path and environment noise", async () => {
    const p = await mkGitProject("i264-canonical-signatures");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    prevCursorHome = process.env.CURSOR_HOME;
    tempDir = path.join(os.tmpdir(), `i264-cursor-${process.pid}-${Date.now()}`);
    const cursorHome = path.join(tempDir, "cursor");
    process.env.CURSOR_HOME = cursorHome;
    await mkdir(path.join(p.dir, ".cursor/goal/evidence"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/evidence/proof-runs.jsonl"),
      [
        {
          at: new Date().toISOString(),
          ok: false,
          timed_out: true,
          cmd: `npm test -- ${path.join(p.dir, "src/a.ts")}`,
        },
        {
          at: new Date().toISOString(),
          ok: false,
          timed_out: true,
          cmd: "npm test -- /tmp/other-project/src/b.ts",
        },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8",
    );
    await mkdir(path.join(p.dir, ".cursor/goal/passports"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/passports/SESSION_END.json"),
      JSON.stringify({
        at: new Date().toISOString(),
        failure_class: "stale_proof",
        why_no_release: "fingerprint delta: checks passed before working tree changed",
      }),
      "utf8",
    );
    const transcriptDir = path.join(cursorHome, "projects/test/agent-transcripts/session-b");
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      path.join(transcriptDir, "session-b.jsonl"),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        text: `hook_channel_mismatch beforeSubmitPrompt in ${p.dir}`,
      })}\n`,
      "utf8",
    );

    const report = await buildIncidentReport(p.dir, "today");
    expect(report.signature_clusters?.["check_timeout:npm test"]).toBe(2);
    expect(report.signature_clusters?.["stale_proof:fingerprint_delta"]).toBe(1);
    expect(report.signature_clusters?.["hook_channel_mismatch:beforeSubmitPrompt"]).toBe(1);
  });
});
