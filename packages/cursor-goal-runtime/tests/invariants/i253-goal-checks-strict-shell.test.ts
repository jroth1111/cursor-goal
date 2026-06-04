import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseGoalMd } from "../../src/lib/parse-goal-md.js";
import { lintGoalMd } from "../../src/lib/goal-lint.js";
import { mkGitProject } from "../helpers/git-fixture.js";
import { execMinimalStop } from "../hooks/exec-hook.js";

describe("I253 GOAL checks require backticked shell commands", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  async function writeGoal(body: string): Promise<string> {
    const dir = path.join(os.tmpdir(), `i253-checks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "GOAL.md"), body, "utf8");
    return dir;
  }

  async function seedGovernedSession(root: string): Promise<void> {
    await mkdir(path.join(root, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor/goal/session-mode.json"),
      JSON.stringify({ mode: "governed", source: "cli", updated_at: new Date().toISOString() }),
      "utf8",
    );
  }

  it("rejects checklist prose under ## Checks", async () => {
    const dir = await writeGoal(`## Goal
x

## Checks
- [ ] Build/typecheck passes
`);
    await expect(parseGoalMd(dir)).rejects.toThrow(/Checks.*backticked shell command/i);
    const issues = await lintGoalMd(dir);
    expect(issues.some((i) => i.level === "error")).toBe(true);
  });

  it("parses tiered commands when the tier is inside the command backticks", async () => {
    const dir = await writeGoal(`## Goal
x

## Checks
- \`[fast] true\`
- \`[full] npm test\`
`);
    const parsed = await parseGoalMd(dir);
    expect(parsed.checks).toEqual(["true", "npm test"]);
    expect(parsed.checkTiers).toEqual({ true: "fast", "npm test": "full" });
  });

  it("parses tiered commands when the tier prefixes a backticked shell command", async () => {
    const dir = await writeGoal(`## Goal
x

## Checks
- [fast] \`true\`
- [full] \`npm test\`
`);
    const parsed = await parseGoalMd(dir);
    expect(parsed.checks).toEqual(["true", "npm test"]);
    expect(parsed.checkTiers).toEqual({ true: "fast", "npm test": "full" });
  });

  it("minimal fallback accepts tier labels before backticked shell commands", async () => {
    const p = await mkGitProject("i253-minimal-outside-tier");
    dirs.push(p.dir);
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Checks
- [fast] \`true\`
`,
      "utf8",
    );
    await seedGovernedSession(p.dir);
    const r = execMinimalStop(
      p.dir,
      { status: "completed", loop_count: 0 },
      { CURSOR_GOAL_STOP_FOLLOWUP: "1" },
    );
    expect(r.exitCode).toBe(0);
    expect(String(r.stdout.followup_message ?? "")).not.toMatch(/backticked shell command/i);
  });

  it("rejects tier labels without a backticked shell command", async () => {
    const dir = await writeGoal(`## Goal
x

## Checks
- [fast] npm test
`);
    await expect(parseGoalMd(dir)).rejects.toThrow(/Checks.*backticked shell command/i);
  });

  it("minimal fallback rejects tier labels without a backticked shell command", async () => {
    const p = await mkGitProject("i253-minimal-invalid-tier");
    dirs.push(p.dir);
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Checks
- [fast] npm test
`,
      "utf8",
    );
    await seedGovernedSession(p.dir);
    const r = execMinimalStop(
      p.dir,
      { status: "completed", loop_count: 0 },
      { CURSOR_GOAL_STOP_FOLLOWUP: "1" },
    );
    expect(r.exitCode).toBe(0);
    expect(String(r.stdout.followup_message ?? "")).toMatch(/backticked shell command/i);
  });
});
