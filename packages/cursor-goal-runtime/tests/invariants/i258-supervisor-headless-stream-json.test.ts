import { describe, it, expect, afterEach } from "vitest";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { buildAgentArgs } from "../../../../supervisor/run-goal.mjs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I258 supervisor uses Cursor headless stream-json mode", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("buildAgentArgs uses --print with stream-json for machine-managed runs", () => {
    const args = buildAgentArgs("Work toward GOAL.md", false);
    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--trust",
      "--force",
      "Work toward GOAL.md",
    ]);
  });

  it("batch supervisor verifies after headless agent exit instead of waiting only for stop hook passport", async () => {
    const p = await mkGitProject("i258-supervisor-post-verify");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    const fakeHome = path.join(p.dir, "home");
    const fakeCursorHome = path.join(p.dir, "cursor-home");
    const installSh = path.resolve(import.meta.dirname, "../../../../core/install.sh");
    const install = spawnSync("bash", [installSh, "--local-hooks"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, HOME: fakeHome, CURSOR_HOME: fakeCursorHome },
    });
    expect(install.status, install.stderr || install.stdout).toBe(0);

    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nShip batch supervisor\n## Checks\n- `true`\n",
      "utf8",
    );
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "VERIFY" }),
      "utf8",
    );

    const fakeAgent = path.join(p.dir, "fake-cursor-agent.mjs");
    await writeFile(
      fakeAgent,
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import path from "node:path";
writeFileSync(path.join(process.cwd(), "agent-args.json"), JSON.stringify(process.argv.slice(2)));
`,
      "utf8",
    );
    await chmod(fakeAgent, 0o755);

    const supervisor = path.resolve(import.meta.dirname, "../../../../supervisor/run-goal.mjs");
    const runtimeRoot = path.resolve(import.meta.dirname, "../..");
    const r = spawnSync("node", [supervisor, "--parent-only", "--wall-sec=5"], {
      cwd: p.dir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fakeHome,
        CURSOR_HOME: fakeCursorHome,
        CURSOR_AGENT_BIN: fakeAgent,
        CURSOR_GOAL_RUNTIME: runtimeRoot,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const args = JSON.parse(await readFile(path.join(p.dir, "agent-args.json"), "utf8")) as string[];
    expect(args).toContain("--print");
    expect(args).toContain("stream-json");
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/post-agent verify/i);
  });
});
