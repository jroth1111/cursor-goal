import { spawn } from "node:child_process";
import {
  applyLine,
  newAccumulator,
  terminalFor,
  type StreamUsage,
  type TurnTerminal,
} from "./stream.js";

export type TurnMode = "edit" | "ask" | "plan";

export type RunTurnOptions = {
  instruction: string;
  /** session_id to --resume; omitted for a fresh session. */
  resume?: string | null;
  mode?: TurnMode;
  model?: string | null;
  root: string;
  /** hard wall-clock cap for a single turn (ms); kills the child on breach. */
  timeoutMs?: number;
};

export type TurnResult = {
  sessionId: string | null;
  finalText: string;
  usage: StreamUsage | null;
  terminal: TurnTerminal;
  exitCode: number | null;
  timedOut: boolean;
};

export function agentBin(): string {
  return process.env.CURSOR_AGENT_BIN ?? "cursor-agent";
}

/**
 * Build the headless argv. Edit turns get --force --trust and full tool access;
 * ask/plan turns are read-only (the planner/verdict brain must not edit).
 */
export function buildAgentArgs(opts: RunTurnOptions): string[] {
  const args = ["--print", "--output-format", "stream-json", "--stream-partial-output"];
  const mode = opts.mode ?? "edit";
  if (mode === "ask") args.push("--mode", "ask");
  else if (mode === "plan") args.push("--mode", "plan");
  if (opts.model) args.push("--model", opts.model);
  if (opts.resume) args.push("--resume", opts.resume);
  args.push("--trust");
  if (mode === "edit") args.push("--force");
  args.push(opts.instruction);
  return args;
}

// A per-turn timeout exists only to kill a genuinely hung cursor-agent (no output),
// not to bound legitimate long work — set high. Override per call via opts.timeoutMs.
const DEFAULT_TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** Spawn one cursor-agent turn, stream-parse stdout, return a structured result. */
export function runTurn(opts: RunTurnOptions): Promise<TurnResult> {
  const args = buildAgentArgs(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const acc = newAccumulator();
    let stdoutBuf = "";
    let timedOut = false;

    const child = spawn(agentBin(), args, {
      cwd: opts.root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5000).unref();
          }, timeoutMs)
        : null;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      let nl = stdoutBuf.indexOf("\n");
      while (nl >= 0) {
        applyLine(acc, stdoutBuf.slice(0, nl));
        stdoutBuf = stdoutBuf.slice(nl + 1);
        nl = stdoutBuf.indexOf("\n");
      }
    });
    // stderr is drained to avoid backpressure deadlock; content is not parsed.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => undefined);

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuf.trim()) applyLine(acc, stdoutBuf);
      const exitCode = code ?? null;
      const terminal = timedOut ? "aborted" : terminalFor(acc, exitCode);
      resolve({
        sessionId: acc.sessionId,
        finalText: acc.finalText || acc.assistantText,
        usage: acc.usage,
        terminal,
        exitCode,
        timedOut,
      });
    });
  });
}

export function usageTokens(usage: StreamUsage | null): number {
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_read_tokens ?? 0) +
    (usage.cache_write_tokens ?? 0)
  );
}
