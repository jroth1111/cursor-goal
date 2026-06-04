import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { promptScopeWarning } from "../../src/lib/prompt-scope-warning.js";

describe("I266 pre-dispatch intent gate", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("returns one correction command and one fallback safe action for invalid prompt intent", async () => {
    const p = await mkGitProject("i266-intent-gate");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await mkdir(path.join(p.dir, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(p.dir, ".cursor/goal/scope.json"),
      JSON.stringify({ enforce: true, paths: ["src/"] }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/work-units.json"),
      JSON.stringify({
        units: [
          {
            id: "unit-a",
            title: "Unit A",
            scope: ["src/"],
            acceptance: ["done"],
            status: "pending",
            subagent_id: null,
            evidence_path: "evidence/units/unit-a.jsonl",
            role: "implement",
          },
        ],
      }),
      "utf8",
    );

    const warning = await promptScopeWarning(
      p.dir,
      "Dispatch work unit missing-unit and edit docs/README.md",
      "agent-266",
    );
    expect(warning).toContain("unknown unit(s): missing-unit");
    expect(warning).toContain("outside active GOAL scope: docs/README.md");
    expect(warning).toMatch(/Correction: cursor-goal next --conversation agent-266/);
    expect(warning).toContain("Fallback: keep work inside active scope");
  });
});
