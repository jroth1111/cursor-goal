import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatDiff, runDiff } from "../src/driver/diff.js";
import { runGoal } from "../src/driver/loop.js";
import { runJsonPath, writeJson } from "../src/lib/paths.js";
import { mkGitProject, scenarioEnv, withEnv, type Project, type Scenario } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(extraSeed: Record<string, string> = {}): Project {
  const goalMd = "# Goal\n\n## Goal\nDiff test\n\n## Checks\n\n- `test -f made.txt`\n";
  const p = mkGitProject({ "GOAL.md": goalMd, "tracked.txt": "original\n", ...extraSeed });
  cleanups.push(p.cleanup);
  return p;
}

const scenario: Scenario = {
  plan: { tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f made.txt"], acceptance_prose: "" }] },
  turns: [
    {
      mutate: [
        { file: "made.txt", content: "new file\n" }, // untracked addition
        { file: "tracked.txt", content: "edited by the agent\n" }, // tracked modification
      ],
    },
  ],
};

async function runToDone(p: Project, tag: string): Promise<void> {
  const r = await withEnv(scenarioEnv(p.root, scenario, tag), () =>
    runGoal({ root: p.root, budgets: { global_turns: 4, review_rounds: 0 } }),
  );
  expect(r.status).toBe("done");
}

describe("agent-driver diff", () => {
  it("clean start: tracked edits in the diff, agent-created files listed as new", async () => {
    const p = project();
    await runToDone(p, "df1");

    const stat = await runDiff(p.root);
    expect(stat.ok).toBe(true);
    if (!stat.ok) return;
    expect(stat.diff).toMatch(/tracked\.txt/);
    expect(stat.newFiles).toContain("made.txt");
    expect(stat.dirtyNote).toBeNull();

    const full = await runDiff(p.root, { full: true });
    if (!full.ok) return;
    expect(full.diff).toMatch(/\+edited by the agent/);
    expect(full.diff).toMatch(/-original/);
    // driver state never appears
    expect(formatDiff(full)).not.toMatch(/\.cursor\/goal/);
  });

  it("dirty start: pre-run changes flagged with a note pointing at the snapshot; pre-run untracked excluded from new files", async () => {
    const p = project({ "pre-untracked.txt": "" });
    // dirty BEFORE the run: tracked edit + the seeded untracked file is committed... make one truly untracked
    writeFileSync(path.join(p.root, "tracked.txt"), "dirty before run\n");
    writeFileSync(path.join(p.root, "was-here-before.txt"), "pre-run untracked\n");
    await runToDone(p, "df2");

    const out = await runDiff(p.root);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.dirtyNote).toMatch(/dirty at intake/);
    expect(out.dirtyNote).toMatch(/evidence\/baseline\/dirty\.patch/);
    // the file that pre-dated the run is not presented as the run's work
    expect(out.newFiles).not.toContain("was-here-before.txt");
    expect(out.newFiles).toContain("made.txt");
    expect(formatDiff(out)).toMatch(/note: the tree was dirty/);
  });

  it("no baseline (pre-feature run.json) and no run explain themselves", async () => {
    const p = project();
    expect((await runDiff(p.root)).ok).toBe(false);
    expect(formatDiff(await runDiff(p.root))).toMatch(/No driver run/);

    await runToDone(p, "df3");
    const raw = JSON.parse(readFileSync(runJsonPath(p.root), "utf8")) as Record<string, unknown>;
    delete raw.baseline;
    await writeJson(runJsonPath(p.root), raw);
    const out = await runDiff(p.root);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toMatch(/predates baseline capture/);
  });
});
