import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export type HookExecResult = {
  stdout: Record<string, unknown>;
  exitCode: number;
  raw: string;
};

export function execCoreHook(
  projectDir: string,
  step: string,
  stdin: Record<string, unknown>,
  extraEnv: Record<string, string | undefined> = {},
): HookExecResult {
  const hooksDir = path.resolve(
    import.meta.dirname,
    "../../../../core/.cursor/hooks",
  );
  const runtimeRoot = path.resolve(import.meta.dirname, "../../");
  let script: string;
  if (step === "stop") {
    script = path.join(hooksDir, "goal-stop.sh");
  } else {
    const map: Record<string, string> = {
      sessionStart: "goal-session-start.sh",
      beforeSubmitPrompt: "goal-prompt.sh",
      preToolUse: "goal-pre-tool.sh",
      beforeShellExecution: "goal-shell.sh",
      postToolUse: "goal-post-tool.sh",
      subagentStop: "goal-subagent-stop.sh",
      sessionEnd: "goal-session-end.sh",
      preCompact: "goal-pre-compact.sh",
    };
    script = path.join(hooksDir, map[step] ?? "goal-stop.sh");
  }

  const r = spawnSync("bash", [script], {
    cwd: projectDir,
    input: JSON.stringify(stdin),
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
      CURSOR_PROJECT_DIR: projectDir,
      CURSOR_GOAL_RUNTIME: runtimeRoot,
    },
  });

  const raw = (r.stdout ?? "").trim();
  let stdout: Record<string, unknown> = {};
  if (raw) {
    try {
      stdout = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      stdout = {};
    }
  }
  return { stdout, exitCode: r.status ?? 1, raw };
}

export function execMinimalStop(
  projectDir: string,
  stdin: Record<string, unknown>,
  extraEnv: Record<string, string | undefined> = {},
): HookExecResult {
  const script = path.resolve(
    import.meta.dirname,
    "../../../../core/.cursor/hooks/verify-minimal.sh",
  );
  const r = spawnSync("bash", [script, "stop"], {
    cwd: projectDir,
    input: JSON.stringify(stdin),
    encoding: "utf8",
    env: { ...process.env, ...extraEnv, CURSOR_PROJECT_DIR: projectDir },
  });
  const raw = (r.stdout ?? "").trim();
  let stdout: Record<string, unknown> = {};
  if (raw) {
    try {
      stdout = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      stdout = {};
    }
  }
  return { stdout, exitCode: r.status ?? 1, raw };
}

function hookScript(step: string): string {
  const hooksDir = path.resolve(
    import.meta.dirname,
    "../../../../core/.cursor/hooks",
  );
  if (step === "stop") {
    return path.join(hooksDir, "goal-stop.sh");
  }
  const map: Record<string, string> = {
    sessionStart: "goal-session-start.sh",
    beforeSubmitPrompt: "goal-prompt.sh",
    preToolUse: "goal-pre-tool.sh",
    beforeShellExecution: "goal-shell.sh",
    postToolUse: "goal-post-tool.sh",
    subagentStop: "goal-subagent-stop.sh",
    sessionEnd: "goal-session-end.sh",
  };
  return path.join(hooksDir, map[step] ?? "goal-stop.sh");
}

function hookEnvWithoutGlobalRuntime(
  projectDir: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const isolatedHome = path.join(os.tmpdir(), `cgr-hook-isolated-${process.pid}`);
  mkdirSync(isolatedHome, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra,
    CURSOR_PROJECT_DIR: projectDir,
    HOME: isolatedHome,
  };
  delete env.CURSOR_GOAL_RUNTIME;
  return env;
}

/** Run core hook without resolving runtime (I38). */
export function execCoreHookBare(
  projectDir: string,
  step: string,
  stdin: Record<string, unknown>,
): HookExecResult {
  const script = hookScript(step);
  const env = hookEnvWithoutGlobalRuntime(projectDir);
  delete env.CURSOR_GOAL_ALLOW_MINIMAL;
  const r = spawnSync("bash", [script], {
    cwd: projectDir,
    input: JSON.stringify(stdin),
    encoding: "utf8",
    env,
  });
  const raw = (r.stdout ?? "").trim();
  let stdout: Record<string, unknown> = {};
  if (raw) {
    try {
      stdout = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      stdout = {};
    }
  }
  return { stdout, exitCode: r.status ?? 1, raw };
}

/** Run core hook with the legacy minimal env var set (I38). */
export function execCoreHookWithMinimalEnv(
  projectDir: string,
  step: string,
  stdin: Record<string, unknown>,
): HookExecResult {
  const script = hookScript(step);
  const env = hookEnvWithoutGlobalRuntime(projectDir, {
    CURSOR_GOAL_ALLOW_MINIMAL: "1",
  });
  const r = spawnSync("bash", [script], {
    cwd: projectDir,
    input: JSON.stringify(stdin),
    encoding: "utf8",
    env,
  });
  const raw = (r.stdout ?? "").trim();
  let stdout: Record<string, unknown> = {};
  if (raw) {
    try {
      stdout = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      stdout = {};
    }
  }
  return { stdout, exitCode: r.status ?? 1, raw };
}
