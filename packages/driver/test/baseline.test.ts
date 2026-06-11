import { afterEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { headSha, workingTreeFingerprint } from "../src/lib/git.js";
import { writeJson, runJsonPath } from "../src/lib/paths.js";
import { initRun, loadRun, saveRun } from "../src/state/store.js";
import type { GoalSpec } from "../src/state/schema.js";
import { mkGitProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const spec: GoalSpec = { goal_text: "g", source: "prompt", acceptance_checks: [], non_goals: [], scope: [] };

describe("baseline capture at intake", () => {
  it("clean repo: records HEAD and fingerprint, no dirty artifact", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const run = await initRun(spec, p.root);
    expect(run.baseline).not.toBeNull();
    expect(run.baseline!.head_sha).toBe(headSha(p.root));
    expect(run.baseline!.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(run.baseline!.dirty_patch_artifact).toBeNull();
    expect(run.baseline!.fingerprint).toBe(workingTreeFingerprint(p.root));
  });

  it("dirty repo: saves the pre-run patch and untracked list as artifacts", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    writeFileSync(path.join(p.root, "seed.txt"), "modified before the run\n");
    writeFileSync(path.join(p.root, "pre-existing.txt"), "untracked dirt\n");

    const run = await initRun(spec, p.root);
    const artifact = run.baseline!.dirty_patch_artifact;
    expect(artifact).toBeTruthy();
    const patchAbs = path.join(p.root, artifact!);
    expect(existsSync(patchAbs)).toBe(true);
    const patch = readFileSync(patchAbs, "utf8");
    expect(patch).toMatch(/seed\.txt/);
    expect(patch).toMatch(/modified before the run/);
    const untracked = readFileSync(path.join(path.dirname(patchAbs), "untracked.txt"), "utf8");
    expect(untracked).toMatch(/pre-existing\.txt/);
  });

  it("staged changes appear ONCE in the patch (git diff HEAD already contains the index)", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    writeFileSync(path.join(p.root, "seed.txt"), "STAGED-MARKER-LINE\n");
    execSync("git add seed.txt", { cwd: p.root });

    const run = await initRun(spec, p.root);
    const patch = readFileSync(path.join(p.root, run.baseline!.dirty_patch_artifact!), "utf8");
    const occurrences = patch.split("STAGED-MARKER-LINE").length - 1;
    expect(occurrences).toBe(1); // a duplicated hunk makes the snapshot fail `git apply`
  });

  it("repo with no commits: head_sha is null and capture does not crash", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "driver-nb-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    execSync("git init -q", { cwd: root });
    writeFileSync(path.join(root, "only.txt"), "untracked in fresh repo\n");

    const run = await initRun(spec, root);
    expect(run.baseline!.head_sha).toBeNull();
    // everything is untracked dirt in a fresh repo — it still gets snapshotted
    expect(run.baseline!.dirty_patch_artifact).toBeTruthy();
  });

  it("backward compat: run.json without a baseline loads with baseline null", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const run = await initRun(spec, p.root);
    await saveRun(p.root, run);
    // simulate a pre-baseline run.json by stripping the field
    const raw = JSON.parse(readFileSync(runJsonPath(p.root), "utf8")) as Record<string, unknown>;
    delete raw.baseline;
    await writeJson(runJsonPath(p.root), raw);

    const loaded = await loadRun(p.root);
    expect(loaded).not.toBeNull();
    expect(loaded!.baseline).toBeNull();
  });

  it("budget overrides merge at init", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const run = await initRun(spec, p.root, { global_turns: 7, review_rounds: 0 });
    expect(run.budgets.global_turns).toBe(7);
    expect(run.budgets.review_rounds).toBe(0);
    expect(run.budgets.task_attempts).toBeGreaterThan(0); // defaults still present
  });
});
