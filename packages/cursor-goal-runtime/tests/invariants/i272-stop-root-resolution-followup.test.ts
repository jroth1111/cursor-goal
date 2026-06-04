import { describe, it, expect, afterEach } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../../");

type HookOutput = Record<string, unknown>;

async function installHooksFixture(): Promise<{ cursorHome: string; hooksDir: string }> {
  const cursorHome = await mkdtemp(path.join(os.tmpdir(), "i272-cursor-"));
  const hooksDir = path.join(cursorHome, "hooks");
  await cp(path.join(repoRoot, "core/.cursor/hooks"), hooksDir, { recursive: true });
  return { cursorHome, hooksDir };
}

function runHook(
  hooksDir: string,
  cursorHome: string,
  script: string,
  args: string[] = [],
  env: Record<string, string | undefined> = {},
): HookOutput {
  const runEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    CURSOR_HOME: cursorHome,
  };
  delete runEnv.CURSOR_PROJECT_DIR;
  if (env.CURSOR_GOAL_STOP_FOLLOWUP === undefined) {
    delete runEnv.CURSOR_GOAL_STOP_FOLLOWUP;
  }

  const r = spawnSync("bash", [path.join(hooksDir, script), ...args], {
    cwd: hooksDir,
    input: JSON.stringify({ status: "completed", conversation_id: "conv-a", loop_count: 0 }),
    encoding: "utf8",
    env: runEnv,
  });
  expect(r.status, r.stderr || r.stdout).toBe(0);
  return JSON.parse((r.stdout ?? "{}").trim() || "{}") as HookOutput;
}

describe("I272 stop root-resolution fallback cannot inject user turns by default", () => {
  let cursorHome: string | undefined;
  let hooksDir: string | undefined;

  afterEach(async () => {
    if (cursorHome) await rm(cursorHome, { recursive: true, force: true });
    cursorHome = undefined;
    hooksDir = undefined;
  });

  async function fixture() {
    const f = await installHooksFixture();
    cursorHome = f.cursorHome;
    hooksDir = f.hooksDir;
    return f;
  }

  it("dispatcher stop root-resolution failure returns no followup_message unless explicitly enabled", async () => {
    const f = await fixture();

    const defaultOut = runHook(f.hooksDir, f.cursorHome, "goal-stop.sh");
    const optInOut = runHook(f.hooksDir, f.cursorHome, "goal-stop.sh", [], {
      CURSOR_GOAL_STOP_FOLLOWUP: "1",
    });

    expect(defaultOut.followup_message).toBeUndefined();
    expect(String(optInOut.followup_message ?? "")).toContain("CURSOR_PROJECT_DIR missing");
  });

  it("legacy minimal handler stop root-resolution failure follows the same opt-in rule", async () => {
    const f = await fixture();

    const defaultOut = runHook(f.hooksDir, f.cursorHome, "handlers-minimal.sh", ["stop"]);
    const optInOut = runHook(f.hooksDir, f.cursorHome, "handlers-minimal.sh", ["stop"], {
      CURSOR_GOAL_STOP_FOLLOWUP: "1",
    });

    expect(defaultOut.followup_message).toBeUndefined();
    expect(String(optInOut.followup_message ?? "")).toContain("CURSOR_PROJECT_DIR missing");
  });
});
