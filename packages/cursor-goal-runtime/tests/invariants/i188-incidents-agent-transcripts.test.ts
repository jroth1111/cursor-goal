import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I188 incidents agent transcript JSONL", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;
  let tempDir = "";

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    await rm(tempDir, { recursive: true, force: true });
    cleanup = undefined;
    restore = undefined;
    tempDir = "";
  });

  it("clusters Cursor agent transcript JSONL failures for the current project", async () => {
    const p = await mkGitProject("i188-transcript-incidents");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    tempDir = path.join(os.tmpdir(), `i188-cursor-${process.pid}-${Date.now()}`);
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
              text: `cursor-goal stalled in ${p.dir}: terminal exit_code unknown while running npm test`,
            },
          ],
        },
      })}\n`,
      "utf8",
    );

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "incidents", "--since", "today", "--json"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_HOME: cursorHome },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const report = JSON.parse(r.stdout) as { clusters?: Record<string, number> };
    expect(report.clusters?.agent_transcript_failure).toBe(1);
  });
});
