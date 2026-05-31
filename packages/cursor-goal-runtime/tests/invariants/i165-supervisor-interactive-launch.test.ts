import { describe, it, expect, afterEach } from "vitest";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I165 supervisor interactive launch", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("spawns cursor-agent without print flags in interactive mode", async () => {
    const p = await mkGitProject("i165-supervisor-interactive-launch");
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

    const fakeAgent = path.join(p.dir, "fake-cursor-agent.mjs");
    await writeFile(
      fakeAgent,
      `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
writeFileSync(path.join(process.cwd(), "agent-args.json"), JSON.stringify(process.argv.slice(2)));
mkdirSync(path.join(process.cwd(), ".cursor/goal/passports"), { recursive: true });
writeFileSync(path.join(process.cwd(), ".cursor/goal/passports/RELEASE.json"), "{}\\n");
`,
      "utf8",
    );
    await chmod(fakeAgent, 0o755);

    const supervisor = path.resolve(import.meta.dirname, "../../../../supervisor/run-goal.mjs");
    const r = spawnSync("node", [supervisor, "--interactive"], {
      cwd: p.dir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fakeHome,
        CURSOR_HOME: fakeCursorHome,
        CURSOR_AGENT_BIN: fakeAgent,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(JSON.parse(await readFile(path.join(p.dir, "agent-args.json"), "utf8"))).toEqual([]);
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);
  });
});
