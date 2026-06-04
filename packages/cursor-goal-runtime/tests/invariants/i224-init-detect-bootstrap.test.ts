import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I224 init --detect bootstrap", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("does not execute acceptance probes by default", async () => {
    const p = await mkGitProject("i224-no-probe-default");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### day1-unsafe
Unsafe probe
- scope: \`pkg/\`
- acceptance: \`node -e "require('node:fs').writeFileSync('.detect-probe-ran','1')"\`
## Checks
- \`true\`
`,
      "utf8",
    );
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "init", "--detect"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    expect(existsSync(path.join(p.dir, ".detect-probe-ran"))).toBe(false);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/Acceptance probes skipped by default/i);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/acceptance not probed/i);
  });

  it("executes acceptance probes only with --probe-acceptance", async () => {
    const p = await mkGitProject("i224-probe-opt-in");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### day1-optin
Opt in probe
- scope: \`pkg/\`
- acceptance: \`node -e "require('node:fs').writeFileSync('.detect-probe-ran','1')"\`
## Checks
- \`true\`
`,
      "utf8",
    );
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "init", "--detect", "--probe-acceptance"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    expect(existsSync(path.join(p.dir, ".detect-probe-ran"))).toBe(true);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/acceptance would pass today/i);
  });

  it("prints bootstrap report for scope-derived units", async () => {
    const p = await mkGitProject("i224");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "pkg"), { recursive: true });
    await writeFile(path.join(p.dir, "pkg", "ok.txt"), "ok\n", "utf8");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Scope
- \`pkg/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "init", "--detect"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/acceptance not probed/i);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/Suggested GOAL.md bootstrap/i);
  });
});
