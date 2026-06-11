import { afterEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGoal } from "../src/driver/loop.js";
import { createRunWorktree, worktreeSummary } from "../src/driver/worktree.js";
import { workingTreeFingerprint } from "../src/lib/git.js";
import { loadRun } from "../src/state/store.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(seed: Record<string, string> = {}): Project {
  const p = mkGitProject(seed);
  cleanups.push(p.cleanup);
  return p;
}

describe("createRunWorktree", () => {
  it("creates a branched worktree; collisions (dir OR leftover branch) get suffixes", () => {
    const p = project();
    const first = createRunWorktree(p.root, "same goal");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(existsSync(path.join(first.root, "seed.txt"))).toBe(true);
    expect(first.branch).toMatch(/^agent-driver\/[0-9a-f]{12}$/);

    const second = createRunWorktree(p.root, "same goal");
    expect(second.ok && second.root).toMatch(/-2$/);
    expect(second.ok && second.branch).toMatch(/-2$/);

    // remove the second worktree but keep its branch: the next one must skip to -3
    execSync(`git worktree remove --force "${(second as { root: string }).root}"`, { cwd: p.root });
    const third = createRunWorktree(p.root, "same goal");
    expect(third.ok && third.branch).toMatch(/-3$/);
  });

  it("refuses in a repo with no commits", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "driver-wt-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    execSync("git init -q", { cwd: root });
    const out = createRunWorktree(root, "g");
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toMatch(/no commits/);
  });

  it("copies an untracked GOAL.md into the worktree so the goal contract survives", () => {
    const p = project();
    writeFileSync(path.join(p.root, "GOAL.md"), "# Goal\n\n## Goal\nUntracked goal\n\n## Checks\n\n- `true`\n");
    const wt = createRunWorktree(p.root, "Untracked goal");
    expect(wt.ok && existsSync(path.join((wt as { root: string }).root, "GOAL.md"))).toBe(true);
  });

  it("a tracked GOAL.md with UNCOMMITTED edits also reaches the worktree — the live contract wins over HEAD", () => {
    // commit one goal, then rewrite it without committing: the worktree would
    // otherwise materialize the stale HEAD version and silently drive the old goal
    const p = project({ "GOAL.md": "# Goal\n\n## Goal\nOld committed goal\n\n## Checks\n\n- `true`\n" });
    const fresh = "# Goal\n\n## Goal\nNew uncommitted goal\n\n## Checks\n\n- `test -f new.txt`\n";
    writeFileSync(path.join(p.root, "GOAL.md"), fresh);
    const wt = createRunWorktree(p.root, "New uncommitted goal");
    expect(wt.ok).toBe(true);
    if (!wt.ok) return;
    expect(readFileSync(path.join(wt.root, "GOAL.md"), "utf8")).toBe(fresh);
  });
});

describe("worktree run isolation (e2e)", () => {
  it("the run mutates only the worktree; state lives there; the user's checkout fingerprint is unchanged", async () => {
    const goalMd = "# Goal\n\n## Goal\nIsolated goal\n\n## Checks\n\n- `test -f made.txt`\n";
    const p = project({ "GOAL.md": goalMd, "src/app.ts": "original\n" });
    const beforeFingerprint = workingTreeFingerprint(p.root);

    const wt = createRunWorktree(p.root, "Isolated goal");
    expect(wt.ok).toBe(true);
    if (!wt.ok) return;

    const scenario: Scenario = {
      plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
      turns: [
        {
          mutate: [
            { file: "made.txt", content: "new" },
            { file: "src/app.ts", content: "edited by the agent\n" },
          ],
        },
      ],
    };
    // the scenario file lives under the MAIN root but env paths are absolute,
    // so the stub finds it no matter the spawn cwd
    const result = await withEnv(scenarioEnv(p.root, scenario, "wt1"), () =>
      runGoal({ root: wt.root, budgets: { global_turns: 4, review_rounds: 0 } }),
    );
    expect(result.status).toBe("done");

    // all mutations landed in the worktree…
    expect(existsSync(path.join(wt.root, "made.txt"))).toBe(true);
    expect(existsSync(path.join(wt.root, ".cursor", "goal", "driver", "run.json"))).toBe(true);
    expect((await loadRun(wt.root))?.status).toBe("done");

    // …and the user's checkout is byte-identical to before
    expect(existsSync(path.join(p.root, "made.txt"))).toBe(false);
    expect(await loadRun(p.root)).toBeNull();
    expect(workingTreeFingerprint(p.root)).toBe(beforeFingerprint);

    // the summary names everything the human needs to adopt or discard
    const summary = worktreeSummary(p.root, wt.root, wt.branch);
    expect(summary).toContain(wt.root);
    expect(summary).toContain(wt.branch);
    expect(summary).toMatch(/src\/app\.ts/); // tracked change in the stat
    expect(summary).toMatch(/untracked: .*made\.txt/);
    expect(summary).toMatch(/worktree remove --force/);
  });
});
