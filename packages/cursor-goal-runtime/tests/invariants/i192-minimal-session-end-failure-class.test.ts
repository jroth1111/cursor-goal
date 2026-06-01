import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject } from "../helpers/git-fixture.js";
import { execCoreHookBare } from "../hooks/exec-hook.js";
import { goalDir } from "../../src/lib/paths.js";
import { sessionEndMarkerPath } from "../../src/lib/disposition.js";

describe("I192 minimal session-end failure class", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("writes failure_class in minimal fallback SESSION_END diagnostics", async () => {
    const p = await mkGitProject("i192-minimal-session-end");
    cleanup = p.cleanup;
    await mkdir(path.join(goalDir(p.dir), "evidence"), { recursive: true });
    await writeFile(
      path.join(goalDir(p.dir), "evidence/proof-runs.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), cmd: "npm test", ok: true })}\n`,
      "utf8",
    );

    const r = execCoreHookBare(p.dir, "sessionEnd", { conversation_id: "agent-a" });

    expect(r.exitCode, r.raw).toBe(0);
    const marker = JSON.parse(await readFile(sessionEndMarkerPath(p.dir), "utf8")) as {
      failure_class?: string;
      why_no_release?: string;
    };
    expect(marker.failure_class).toBe("green_but_unreleased");
    expect(marker.why_no_release).toMatch(/checks passed/i);
  });
});
