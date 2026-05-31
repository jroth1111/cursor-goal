import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildAgentArgs, buildUnitTaskPrompt } from "../../../../supervisor/run-goal.mjs";

describe("I09 supervisor prompt argv", () => {
  it("buildAgentArgs includes --print --trust --force and prompt", () => {
    const args = buildAgentArgs("Ship feature X per GOAL.md", false);
    expect(args).toEqual(["--print", "--trust", "--force", "Ship feature X per GOAL.md"]);
  });

  it("buildUnitTaskPrompt includes work_unit_id", () => {
    const p = buildUnitTaskPrompt({
      id: "mod-a",
      title: "Module A",
      scope: ["pkg/a/"],
      acceptance: ["true"],
    });
    expect(p).toContain("work_unit_id: mod-a");
  });

  it("mock cursor-agent receives buildAgentArgs", async () => {
    const dir = path.join(os.tmpdir(), `cgr-sup-${Date.now()}`);
    const binDir = path.join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    const mockAgent = path.join(binDir, "cursor-agent");
    await writeFile(
      mockAgent,
      `#!/usr/bin/env bash
echo "$@" > "$CURSOR_PROJECT_DIR/.cursor/goal/agent-argv.txt"
exit 0
`,
      "utf8",
    );
    await chmod(mockAgent, 0o755);
    await mkdir(path.join(dir, ".cursor", "goal"), { recursive: true });

    const agentArgs = buildAgentArgs("test prompt here", false);
    spawnSync(mockAgent, agentArgs, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: dir },
    });

    const { readFile } = await import("node:fs/promises");
    const argv = await readFile(path.join(dir, ".cursor/goal/agent-argv.txt"), "utf8");
    expect(argv).toMatch(/--print/);
    expect(argv).toMatch(/test prompt here/);
    await rm(dir, { recursive: true, force: true });
  });
});
