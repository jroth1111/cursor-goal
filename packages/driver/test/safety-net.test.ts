import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shellPolicyDenyFixtures } from "../src/lib/shell-allow.js";
import { mkGitProject } from "./helpers.js";

const HOOK = fileURLToPath(new URL("../dist/hooks/safety-net.js", import.meta.url));

function runHook(payload: unknown, env: NodeJS.ProcessEnv = {}): Promise<{ out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", () => resolve({ out }));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("safety-net hook", () => {
  it("denies every destructive deny_fixture on preToolUse", async () => {
    for (const cmd of shellPolicyDenyFixtures()) {
      const { out } = await runHook({ hook_event_name: "preToolUse", tool_name: "shell", tool_input: { command: cmd } });
      const res = JSON.parse(out);
      expect(res.permission, cmd).toBe("deny");
    }
  });

  it("allows benign commands on preToolUse", async () => {
    const { out } = await runHook({ hook_event_name: "preToolUse", tool_name: "shell", tool_input: { command: "npm test" } });
    expect(JSON.parse(out).permission).toBe("allow");
  });

  it("finds the command in any nested string field", async () => {
    const { out } = await runHook({
      hook_event_name: "preToolUse",
      tool_name: "custom",
      tool_input: { args: { script: "git push --force origin main" } },
    });
    expect(JSON.parse(out).permission).toBe("deny");
  });

  it("captures evidence on postToolUse and returns empty", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const { out } = await runHook(
      { hook_event_name: "postToolUse", tool_name: "shell", tool_use_id: "u1", cwd: p.root, tool_output: "ok", duration: 12 },
      { CURSOR_PROJECT_DIR: p.root },
    );
    expect(JSON.parse(out)).toEqual({});
    const evidence = path.join(p.root, ".cursor/goal/driver/evidence/tool-runs.jsonl");
    expect(existsSync(evidence)).toBe(true);
    expect(readFileSync(evidence, "utf8")).toMatch(/"tool_use_id":"u1"/);
  });

  it("stop hook with no governed run returns empty (lets the agent stop)", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const { out } = await runHook({ hook_event_name: "stop", loop_count: 1 }, { CURSOR_PROJECT_DIR: p.root });
    expect(JSON.parse(out)).toEqual({});
  });
});
