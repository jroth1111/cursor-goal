import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { formatGovernedSubmitHeader } from "../../src/lib/governed-submit-header.js";
import { writeSessionMode } from "../../src/lib/governance-config.js";

describe("I227 governed submit header", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("formats goal phase units and loop from compiled artifacts", async () => {
    const p = await mkGitProject("i227");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nShip feature\n", "utf8");
    await writeFile(
      path.join(p.dir, ".cursor/goal/intent.json"),
      JSON.stringify({ goal: "Ship the feature end to end" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "IMPLEMENT" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/work-units.json"),
      JSON.stringify({
        units: [
          {
            id: "u1",
            title: "U1",
            scope: ["src/"],
            acceptance: ["true"],
            status: "pending",
            subagent_id: null,
            evidence_path: "evidence/units/u1.jsonl",
            role: "implement",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/dispatch-queue.json"),
      JSON.stringify({
        items: [{ order: 0, unit_id: "u1", title: "U1", scope: ["src/"], acceptance: ["true"] }],
        head_index: 0,
      }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/runtime-state.json"),
      JSON.stringify({
        mode: "runtime",
        total_blocked_stops: 2,
        loop_limit: 40,
        phase: "IMPLEMENT",
        blocked_agent_count: 0,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    const header = await formatGovernedSubmitHeader(p.dir);
    expect(header).toMatch(/^Goal: Ship the feature/);
    expect(header).toMatch(/Phase: IMPLEMENT/);
    expect(header).toMatch(/Units open: 1\/1 \(head: u1\)/);
    expect(header).toMatch(/Loop: 2\/40/);
    expect(header).toMatch(/Mode: governed/);
  });

  it("uses resolveQueueHead not stale head_index when first unit is done", async () => {
    const p = await mkGitProject("i227-head");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nShip\n", "utf8");
    await writeFile(
      path.join(p.dir, ".cursor/goal/intent.json"),
      JSON.stringify({ goal: "Ship modules" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "IMPLEMENT" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/work-units.json"),
      JSON.stringify({
        units: [
          {
            id: "mod-a",
            title: "A",
            scope: ["pkg/a/"],
            acceptance: ["true"],
            status: "done",
            subagent_id: null,
            evidence_path: "evidence/units/mod-a.jsonl",
            role: "implement",
          },
          {
            id: "mod-b",
            title: "B",
            scope: ["pkg/b/"],
            acceptance: ["true"],
            status: "pending",
            subagent_id: null,
            evidence_path: "evidence/units/mod-b.jsonl",
            role: "implement",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/dispatch-queue.json"),
      JSON.stringify({
        items: [
          { order: 0, unit_id: "mod-a", title: "A", scope: ["pkg/a/"], acceptance: ["true"] },
          { order: 1, unit_id: "mod-b", title: "B", scope: ["pkg/b/"], acceptance: ["true"] },
        ],
        head_index: 0,
      }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/runtime-state.json"),
      JSON.stringify({
        mode: "runtime",
        total_blocked_stops: 0,
        loop_limit: 40,
        phase: "IMPLEMENT",
        blocked_agent_count: 0,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    const header = await formatGovernedSubmitHeader(p.dir);
    expect(header).toMatch(/Units open: 1\/2 \(head: mod-b\)/);
    expect(header).not.toMatch(/head: mod-a/);
  });

  it("sessionStart injects governed header in additional_context", async () => {
    const p = await mkGitProject("i227-hook");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nShip feature\n", "utf8");
    await writeSessionMode(p.dir, "governed", "cli");
    await writeFile(
      path.join(p.dir, ".cursor/goal/intent.json"),
      JSON.stringify({ goal: "Ship the feature end to end" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "VERIFY" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/runtime-state.json"),
      JSON.stringify({
        mode: "runtime",
        total_blocked_stops: 1,
        loop_limit: 40,
        phase: "VERIFY",
        blocked_agent_count: 0,
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    const hook = path.resolve(import.meta.dirname, "../../dist/hook-sessionStart.mjs");
    const r = spawnSync("node", [hook], {
      cwd: p.dir,
      input: JSON.stringify({ conversation_id: "i227-hook" }),
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout || "{}") as { additional_context?: string };
    expect(out.additional_context ?? "").toMatch(/Goal: Ship feature/);
    expect(out.additional_context ?? "").toMatch(/Phase: VERIFY/);
    expect(out.additional_context ?? "").toMatch(/Mode: governed/);
  });
});
