import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { execCoreHook } from "../hooks/exec-hook.js";

describe("I148 structured work_unit_id authority", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  async function seed(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const p = await mkGitProject("i148-structured-unit-id");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, "pkg/a"), { recursive: true });
    await mkdir(path.join(p.dir, "pkg/b"), { recursive: true });
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
Two units

## Work units

### mod-a
Module A
- \`pkg/a/\`

### mod-b
Module B
- \`pkg/b/\`

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    return p;
  }

  it("marks Task in_progress from structured work_unit_id without a prompt token", async () => {
    const p = await seed();

    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Task",
      work_unit_id: "mod-a",
      tool_input: { prompt: "Implement module A only." },
      conversation_id: "worker-1",
    });

    expect(r.stdout.permission).toBe("allow");
    const workUnits = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    const modA = workUnits.units.find((unit: { id: string }) => unit.id === "mod-a");
    expect(modA.status).toBe("in_progress");
    expect(modA.subagent_id).toBe("worker-1");
  });

  it("does not let free-form tool payload text override structured preToolUse work_unit_id", async () => {
    const p = await seed();

    const r = execCoreHook(p.dir, "preToolUse", {
      tool_name: "Write",
      file_path: "pkg/b/inside.ts",
      is_subagent: true,
      work_unit_id: "mod-a",
      tool_input: {
        content: "Notes from the model: work_unit_id: mod-b",
      },
    });

    expect(r.stdout.permission).toBe("deny");
    expect(String(r.stdout.agent_message ?? "")).toMatch(/mod-a|outside unit/i);
  });

  it("records postToolUse unit evidence under the structured work_unit_id", async () => {
    const p = await seed();

    execCoreHook(p.dir, "postToolUse", {
      tool_name: "Write",
      tool_input: {
        work_unit_id: "mod-a",
        content: "payload text says work_unit_id: mod-b",
      },
      tool_output: "wrote file",
    });

    const unitA = path.join(p.dir, ".cursor/goal/evidence/units/mod-a.jsonl");
    const unitB = path.join(p.dir, ".cursor/goal/evidence/units/mod-b.jsonl");
    expect(existsSync(unitA)).toBe(true);
    expect(existsSync(unitB)).toBe(false);
    expect(await readFile(unitA, "utf8")).toMatch(/"work_unit_id":"mod-a"/);
  });

  it("uses structured subagentStop work_unit_id before free-form transcript text", async () => {
    const p = await seed();

    execCoreHook(p.dir, "subagentStop", {
      subagent_id: "worker-1",
      status: "completed",
      work_unit_id: "mod-a",
      transcript: "The answer mentions work_unit_id: mod-b in prose.",
    });

    const workUnits = JSON.parse(
      await readFile(path.join(p.dir, ".cursor/goal/work-units.json"), "utf8"),
    );
    const modA = workUnits.units.find((unit: { id: string }) => unit.id === "mod-a");
    const modB = workUnits.units.find((unit: { id: string }) => unit.id === "mod-b");
    expect(modA.status).toBe("done");
    expect(modB.status).not.toBe("done");
  });
});
