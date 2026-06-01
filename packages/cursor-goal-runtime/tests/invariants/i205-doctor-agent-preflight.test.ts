import { describe, it, expect, afterEach } from "vitest";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I205 doctor reports cursor-agent preflight", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("includes agent_preflight in doctor --json when agent is unavailable", async () => {
    const p = await mkGitProject("i205");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    const binDir = path.join(p.dir, "bin");
    await mkdir(binDir, { recursive: true });
    const mockAgent = path.join(binDir, "cursor-agent");
    await writeFile(
      mockAgent,
      `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then exit 1; fi
exit 0
`,
      "utf8",
    );
    await chmod(mockAgent, 0o755);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "doctor", "--json"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir, CURSOR_AGENT_BIN: mockAgent },
    });

    const parsed = JSON.parse(r.stdout) as {
      agent_preflight?: { available?: boolean; bin?: string };
      issues?: { message?: string }[];
    };
    expect(parsed.agent_preflight?.available).toBe(false);
    expect(parsed.agent_preflight?.bin).toBe(mockAgent);
    expect(parsed.issues?.some((i) => /dispatch --verify --spawn/i.test(i.message ?? ""))).toBe(true);
  });
});
