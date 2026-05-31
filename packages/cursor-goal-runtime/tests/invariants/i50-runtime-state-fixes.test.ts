import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { execCoreHook } from "../hooks/exec-hook.js";
import { readTrajectory } from "../../src/trajectory/fsm.js";
import { isRuntimeStateStale } from "../../src/lib/dispatch-cli.js";
import { readRuntimeState, writeRuntimeStateFile } from "../../src/lib/runtime-state.js";
import { readDispatchQueue, resolveQueueHead } from "../../src/lib/dispatch-queue.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { markUnitDoneWithEvidence, seedReleaseReady } from "../helpers/release-ready.js";

describe("I50 runtime-state recommended fixes", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("1. beforeShellExecution allows normal shell and blocks destructive shell", async () => {
    const p = await mkGitProject("i50-shell");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "package.json"), '{"scripts":{"test":"true"}}\n', "utf8");
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `npm test`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);

    const hook = path.resolve(import.meta.dirname, "../../dist/hook-beforeShellExecution.mjs");
    const allow = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ command: "npm test -- --run" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((allow.stdout ?? "{}").trim()).permission).toBe("allow");

    const wrapped = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ command: `cd ${JSON.stringify(p.dir)} && uv run pytest -m "not live" -q 2>&1 | tail -20` }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(JSON.parse((wrapped.stdout ?? "{}").trim()).permission).toBe("allow");

    const deny = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ command: "rm -rf /tmp/cursor-goal-nope" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    const denied = JSON.parse((deny.stdout ?? "{}").trim());
    expect(denied.permission).toBe("deny");
    expect(denied.agent_message).toMatch(/destructive/i);
  });

  it("2. work-units.json mtime marks runtime-state stale", async () => {
    const p = await mkGitProject("i50-stale");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(await isRuntimeStateStale(p.dir)).toBe(false);

    await markUnitDoneWithEvidence("mod-a", p.dir);
    expect(await isRuntimeStateStale(p.dir)).toBe(true);
  });

  it("2b. malformed generated manifest marks runtime-state stale", async () => {
    const p = await mkGitProject("i50-stale-manifest");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(await isRuntimeStateStale(p.dir)).toBe(false);

    await writeFile(path.join(p.dir, ".cursor/goal/manifest.json"), "{", "utf8");
    await expect(isRuntimeStateStale(p.dir)).resolves.toBe(true);
  });

  it("3. subagentStop preserves RELEASE.json", async () => {
    const p = await mkGitProject("i50-release");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await seedReleaseReady(p.dir);
    const released = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(released.kind).toBe("release");

    execCoreHook(p.dir, "subagentStop", { status: "completed", agent: "sub" });
    expect(existsSync(path.join(p.dir, ".cursor/goal/passports/RELEASE.json"))).toBe(true);
  });

  it("4. invalidator message surfaces in stop followup", async () => {
    const p = await mkGitProject("i50-proxy");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `true`\n## Forbidden proxies\n- tests pass but\n",
      "utf8",
    );
    await compileGoalV2(p.dir);
    await writeFile(
      path.join(p.dir, ".cursor/goal/PROGRESS.md"),
      "tests pass but nothing was run\n",
      "utf8",
    );
    await seedReleaseReady(p.dir);
    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    if (r.kind === "continue") {
      expect(r.message).toMatch(/forbidden proxy|proxy language/i);
    }
  });

  it("5. readTrajectory normalizes invalid phase", async () => {
    const p = await mkGitProject("i50-traj");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, ".cursor/goal/trajectory.json"), '{"phase":null}\n', "utf8");
    const traj = await readTrajectory(p.dir);
    expect(traj.phase).toBe("DISCOVERY");
  });

  it("6. resolveQueueHead uses and syncs head_index", async () => {
    const p = await mkGitProject("i50-head");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x
## Work units
### mod-a
A
- \`pkg/a/\`
### mod-b
B
- \`pkg/b/\`
## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    await markUnitDoneWithEvidence("mod-a", p.dir);

    const head = await resolveQueueHead(p.dir);
    expect(head?.item.unit_id).toBe("mod-b");
    expect(head?.index).toBe(1);

    const queue = await readDispatchQueue(p.dir);
    expect(queue?.head_index).toBe(1);
  });
});
