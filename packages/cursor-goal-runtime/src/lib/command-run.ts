import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "./paths.js";
import { gitTreeId } from "./git-state.js";
import { shellCommandAllowed } from "./shell-allow.js";
import { checkTimeoutMs } from "./run-checks.js";

export type RunCommandOptions = {
  timeoutMs?: number;
  source?: string;
};

export type RunCommandResult = {
  cmd: string;
  ok: boolean;
  status: number;
  signal?: string;
  timed_out: boolean;
  elapsed_ms: number;
  output: string;
  tree: string;
};

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export async function appendProofRun(root: string, row: Record<string, unknown>): Promise<void> {
  const proofRunsPath = path.join(goalDir(root), "evidence", "proof-runs.jsonl");
  await mkdir(path.dirname(proofRunsPath), { recursive: true });
  await appendFile(proofRunsPath, `${JSON.stringify(row)}\n`, "utf8");
}

export async function runWrappedCommand(
  root: string,
  commandTokens: string[],
  options: RunCommandOptions = {},
): Promise<RunCommandResult> {
  if (commandTokens.length === 0) {
    throw new Error("cursor-goal run requires a command after --");
  }
  const timeoutMs = options.timeoutMs ?? checkTimeoutMs();
  const cmd = commandTokens.map(shellQuote).join(" ");
  const tree = gitTreeId(root);
  const started = Date.now();
  let status = 1;
  let signal: string | undefined;
  let timedOut = false;
  let output = "";

  if (!shellCommandAllowed(cmd)) {
    output = "Destructive command blocked by cursor-goal-runtime.";
  } else {
    const r = await new Promise<{ status: number; signal?: string; timedOut: boolean; output: string }>((resolve) => {
      const child = spawn(commandTokens[0], commandTokens.slice(1), {
        cwd: root,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let childOutput = "";
      let childTimedOut = false;
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;

      const append = (chunk: unknown): void => {
        if (childOutput.length >= 4000) return;
        childOutput = `${childOutput}${String(chunk)}`.slice(0, 4000);
      };
      const killChild = (signalToSend: NodeJS.Signals): void => {
        if (!child.pid) return;
        try {
          if (process.platform === "win32") {
            child.kill(signalToSend);
          } else {
            process.kill(-child.pid, signalToSend);
          }
        } catch {
          // The process group may have already exited.
        }
      };
      const finish = (result: { status: number; signal?: string; timedOut: boolean; output: string }): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        resolve(result);
      };

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.on("error", (err) => {
        finish({ status: 1, timedOut: childTimedOut, output: `${err.message}\n${childOutput}`.trim() });
      });
      child.on("close", (code, closeSignal) => {
        const resultOutput = childTimedOut
          ? `command timed out after ${timeoutMs}ms\n${childOutput}`.trim()
          : childOutput.trim();
        finish({
          status: childTimedOut ? 124 : code ?? (closeSignal ? 124 : 1),
          ...(closeSignal ? { signal: closeSignal } : {}),
          timedOut: childTimedOut,
          output: resultOutput,
        });
      });
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          childTimedOut = true;
          killChild("SIGTERM");
          killTimer = setTimeout(() => killChild("SIGKILL"), 250);
        }, timeoutMs);
      }
    });
    status = r.status;
    signal = r.signal;
    timedOut = r.timedOut;
    output = r.output;
  }

  const elapsedMs = Date.now() - started;
  const result: RunCommandResult = {
    cmd,
    ok: status === 0,
    status,
    ...(signal ? { signal } : {}),
    timed_out: timedOut,
    elapsed_ms: elapsedMs,
    output,
    tree,
  };
  await appendProofRun(root, {
    at: new Date().toISOString(),
    ...result,
    source: options.source ?? "cursor-goal run",
  });
  return result;
}
