import { describe, it, expect, afterEach } from "vitest";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { readSessionEndDiagnostics, formatSessionEndDiagnostics, type SessionEndDiagnostics } from "../../src/lib/session-end-report.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

describe("I213 session end marker includes reason and duration when provided", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("parses reason and duration_ms from session end marker", async () => {
    const p = await mkGitProject("i213-reason");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const passportsDir = path.join(p.dir, ".cursor/goal/passports");
    await mkdir(passportsDir, { recursive: true });
    await writeFile(
      path.join(passportsDir, "SESSION_END.json"),
      JSON.stringify({
        status: "SESSION_END",
        reason: "agent_crashed",
        duration_ms: 45000,
        failure_class: "stop_blocked",
        why_no_release: "last stop did not release (L3)",
      }),
      "utf8",
    );

    const diag = await readSessionEndDiagnostics(p.dir);
    expect(diag).not.toBeNull();
    expect(diag!.reason).toBe("agent_crashed");
    expect(diag!.duration_ms).toBe(45000);
  });

  it("formats reason and duration in explain output", async () => {
    const diag: SessionEndDiagnostics = {
      reason: "timeout",
      duration_ms: 120000,
      failure_class: "checks_failed",
      why_no_release: "last check failed (npm test)",
    };
    const text = formatSessionEndDiagnostics(diag);
    expect(text).toContain("reason: timeout");
    expect(text).toContain("duration_ms: 120000");
  });

  it("gracefully handles missing reason and duration", async () => {
    const diag = formatSessionEndDiagnostics({
      failure_class: "release_missing",
      why_no_release: "release passport missing",
    });
    expect(diag).toContain("reason: unknown");
    expect(diag).not.toContain("duration_ms");
  });
});
