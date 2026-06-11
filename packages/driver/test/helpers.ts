import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAKE_AGENT = fileURLToPath(new URL("./fake-agent/fake-agent.mjs", import.meta.url));

/**
 * Chaos directives make the stub speak pathological dialects (see fake-agent.mjs
 * header for each mode's exact emission). `bad-schema` is not a mode: put a
 * valid-JSON-wrong-schema object straight into verdicts/reviews/plan instead.
 */
export type ChaosDirective = {
  mode:
    | "crash-mid-stream"
    | "garbage-lines"
    | "no-session-id"
    | "no-result-event"
    | "hang"
    | "slow-drip";
  /** crash-mid-stream: NDJSON lines to emit before exiting 1 (default 2). */
  afterLines?: number;
  /** slow-drip: delay between lines in ms (default 30). */
  lineDelayMs?: number;
};

export type Scenario = {
  plan?: unknown;
  replan?: unknown;
  verdicts?: unknown[];
  reviews?: unknown[];
  turns?: Array<{
    mutate?: Array<{ file?: string; content?: string; rm?: string; append?: string }>;
    delta?: string;
    result?: "error" | "aborted";
    exitCode?: number;
    session?: string;
    chaos?: ChaosDirective;
  }>;
};

export type Project = { root: string; cleanup: () => void };

/** Ephemeral git repo with one commit so the working-tree fingerprint has a HEAD. */
export function mkGitProject(seedFiles: Record<string, string> = {}): Project {
  const root = mkdtempSync(path.join(os.tmpdir(), "driver-test-"));
  const run = (cmd: string) => execSync(cmd, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
  run("git init -q");
  run("git config user.email test@test.local");
  run("git config user.name test");
  run("git config commit.gpgsign false");
  writeFileSync(path.join(root, "seed.txt"), "seed\n");
  for (const [rel, content] of Object.entries(seedFiles)) {
    const fp = path.join(root, rel);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, content);
  }
  run("git add -A");
  run("git commit -q -m init");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Write a scenario file and return the env that binds the fake agent to a run.
 * The scenario + fake-state files live under .cursor/goal so they are excluded
 * from the working-tree fingerprint (otherwise the turn counter would look like
 * product progress and break no-progress / oscillation detection).
 */
export function scenarioEnv(root: string, scenario: Scenario, tag = "s"): NodeJS.ProcessEnv {
  const dir = path.join(root, ".cursor", "goal");
  mkdirSync(dir, { recursive: true });
  const scenarioPath = path.join(dir, `scenario-${tag}.json`);
  writeFileSync(scenarioPath, JSON.stringify(scenario));
  const statePath = path.join(dir, `fake-state-${tag}.json`);
  return {
    CURSOR_AGENT_BIN: FAKE_AGENT,
    FAKE_AGENT_SCENARIO: scenarioPath,
    FAKE_AGENT_STATE: statePath,
    CURSOR_PROJECT_DIR: root,
  };
}

/** Apply env vars for the duration of fn, restoring afterward. */
export async function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    process.env[k] = env[k] as string;
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

export const FAKE_AGENT_PATH = FAKE_AGENT;
