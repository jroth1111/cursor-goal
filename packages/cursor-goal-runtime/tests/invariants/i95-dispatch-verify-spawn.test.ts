import { describe, it, expect, afterEach } from "vitest";
import { writeFile, mkdir, chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";
import { runDispatchVerifySpawn } from "../../src/lib/dispatch-verify.js";
import { unitVerifierResultPath } from "../../src/lib/adversarial-paths.js";

describe("I95 dispatch verify spawn", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;
  const prevAgentBin = process.env.CURSOR_AGENT_BIN;
  const prevMockCount = process.env.MOCK_AGENT_COUNT;

  afterEach(async () => {
    if (prevAgentBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevAgentBin;
    if (prevMockCount === undefined) delete process.env.MOCK_AGENT_COUNT;
    else process.env.MOCK_AGENT_COUNT = prevMockCount;
    restore?.();
    await cleanup?.();
  });

  async function seedVerifiedUnit(p: { dir: string }): Promise<void> {
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal
x

## Work units

### u1
Unit
- scope: \`src/\`
- verified_by: verifier

## Checks
- \`true\`
`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const deliverable = path.join(p.dir, ".cursor/goal/outputs/u1/deliverable.md");
    await mkdir(path.dirname(deliverable), { recursive: true });
    await writeFile(deliverable, "summary\n", "utf8");
  }

  it("dry-run prints cursor-agent and prompt snippet without requiring agent", async () => {
    const p = await mkGitProject("i95");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedVerifiedUnit(p);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const r = await runDispatchVerifySpawn(p.dir, { dryRun: true });
      expect(r.summary).toBe("dry-run");
      const joined = logs.join("\n");
      expect(joined).toMatch(/cursor-agent/);
      expect(joined).toMatch(/Adversarial verification/);
    } finally {
      console.log = origLog;
    }
  });

  it("CLI --verify --spawn --dry-run exits 0", async () => {
    const p = await mkGitProject("i95-cli");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedVerifiedUnit(p);
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "dispatch", "--verify", "--spawn", "--dry-run"], {
      cwd: p.dir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_PROJECT_DIR: p.dir },
    });
    expect(r.status).toBe(0);
    expect((r.stdout ?? "") + (r.stderr ?? "")).toMatch(/cursor-agent/);
  });

  it("reprompts once on inconclusive agent output and records the evidence", async () => {
    const p = await mkGitProject("i95-reprompt");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedVerifiedUnit(p);

    const binDir = path.join(p.dir, "bin");
    await mkdir(binDir, { recursive: true });
    const mockAgent = path.join(binDir, "cursor-agent");
    const countFile = path.join(p.dir, "agent-count.txt");
    await writeFile(
      mockAgent,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "mock cursor-agent"
  exit 0
fi
count=0
if [[ -f "$MOCK_AGENT_COUNT" ]]; then
  count="$(cat "$MOCK_AGENT_COUNT")"
fi
count=$((count + 1))
printf '%s' "$count" > "$MOCK_AGENT_COUNT"
if [[ "$count" == "1" ]]; then
  echo "analysis without final verdict"
else
  echo "VERDICT: PASS"
fi
`,
      "utf8",
    );
    await chmod(mockAgent, 0o755);
    process.env.CURSOR_AGENT_BIN = mockAgent;
    process.env.MOCK_AGENT_COUNT = countFile;

    const r = await runDispatchVerifySpawn(p.dir);
    expect(r.passed).toBe(true);
    expect(r.reprompt_used).toBe(true);
    const stored = JSON.parse(await readFile(unitVerifierResultPath(p.dir, "u1"), "utf8"));
    expect(stored.passed).toBe(true);
    expect(stored.reprompt_used).toBe(true);
  });
});
