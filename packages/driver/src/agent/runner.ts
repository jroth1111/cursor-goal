import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";
import {
  applyLine,
  classifyAnomaly,
  newAccumulator,
  rawSample,
  terminalFor,
  type StreamAnomaly,
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
  /**
   * When set, the raw NDJSON stream is teed here as it arrives (plus stderr lines
   * as {type:"stderr",line} and a final {type:"driver-meta",…} trailer), so a
   * hung or killed turn still leaves its transcript on disk. Best-effort: a
   * transcript that can't be written never fails the turn.
   */
  transcriptPath?: string;
  /** Operator stop: aborting kills the child (TERM, 5s grace, KILL) and the
   *  result carries abort:"operator" so the loop can pause instead of treating
   *  it as an agent failure. */
  signal?: AbortSignal;
};

export type TurnResult = {
  sessionId: string | null;
  finalText: string;
  usage: StreamUsage | null;
  terminal: TurnTerminal;
  exitCode: number | null;
  /** @deprecated derivable: abort === "timeout". Kept for older readers; `abort` is authoritative. */
  timedOut: boolean;
  /**
   * WHY an aborted turn aborted — operator stop vs watchdog timeout vs a stream
   * anomaly (absent/null). Drift classification depends on this distinction:
   * an operator/timeout kill must never be read as a cursor-agent contract change.
   */
  abort?: "operator" | "timeout" | null;
  /** Contract-drift suspicion (see stream.ts classifyAnomaly); never set for
   *  kills or crashes. */
  anomaly?: StreamAnomaly | null;
  /** First/last raw stream lines — evidence for drift artifacts. */
  rawSample?: string[];
};

export function agentBin(): string {
  return process.env.CURSOR_AGENT_BIN ?? "cursor-agent";
}

/**
 * Per-attempt transcript name for retry loops (decompose/verdict/review). The
 * tee truncates on open, so reusing one path across attempts would overwrite
 * the malformed early attempts — exactly the drift evidence worth keeping.
 */
export function retryTranscriptPath(base: string | undefined, attempt: number): string | undefined {
  if (!base || attempt === 0) return base;
  return base.replace(/\.jsonl$/, `.retry${attempt}.jsonl`);
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

/** Bounded stderr capture: past this many lines the transcript notes the drop. */
const TRANSCRIPT_STDERR_CAP = 500;

/**
 * Live tee of the turn's streams into an NDJSON transcript file. stdout chunks
 * are written verbatim as they arrive; stderr lines are wrapped as
 * {type:"stderr",line} and held briefly when stdout sits mid-line so the file
 * stays valid NDJSON. close() appends a {type:"driver-meta"} trailer and
 * resolves once the file is flushed.
 */
class TranscriptTee {
  private stream: WriteStream | null = null;
  private atLineBoundary = true;
  private pendingStderr: string[] = [];
  private stderrBuf = "";
  private stderrLines = 0;

  constructor(file: string) {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      this.stream = createWriteStream(file);
      this.stream.on("error", () => {
        this.stream = null; // disk trouble never fails the turn
      });
    } catch {
      this.stream = null;
    }
  }

  private write(s: string): void {
    try {
      this.stream?.write(s);
    } catch {
      this.stream = null;
    }
  }

  stdout(chunk: string): void {
    if (!chunk) return;
    this.write(chunk);
    this.atLineBoundary = chunk.endsWith("\n");
    if (this.atLineBoundary) this.flushStderr();
  }

  stderr(chunk: string): void {
    // bare \r (progress spinners) counts as a line boundary, else a spinner
    // running for a whole turn accumulates here forever
    this.stderrBuf += chunk.replace(/\r(?!\n)/g, "\n");
    if (this.stderrBuf.length > 64 * 1024) {
      this.stderrBuf = this.stderrBuf.slice(-(64 * 1024)); // cap a line that never ends
    }
    let nl = this.stderrBuf.indexOf("\n");
    while (nl >= 0) {
      const line = this.stderrBuf.slice(0, nl);
      this.stderrBuf = this.stderrBuf.slice(nl + 1);
      nl = this.stderrBuf.indexOf("\n");
      this.stderrLines += 1;
      if (this.stderrLines === TRANSCRIPT_STDERR_CAP) {
        this.pendingStderr.push(JSON.stringify({ type: "stderr", line: "…stderr capped, further lines dropped" }));
      } else if (this.stderrLines < TRANSCRIPT_STDERR_CAP) {
        this.pendingStderr.push(JSON.stringify({ type: "stderr", line }));
      }
    }
    if (this.atLineBoundary) this.flushStderr();
  }

  private flushStderr(): void {
    for (const l of this.pendingStderr) this.write(`${l}\n`);
    this.pendingStderr = [];
  }

  /** Trailing partial stderr (no newline before exit) still counts as a line. */
  private drainStderrTail(): void {
    if (this.stderrBuf.trim() && this.stderrLines < TRANSCRIPT_STDERR_CAP) {
      this.pendingStderr.push(JSON.stringify({ type: "stderr", line: this.stderrBuf }));
    }
    this.stderrBuf = "";
  }

  close(meta: Record<string, unknown>): Promise<void> {
    const s = this.stream;
    if (!s) return Promise.resolve();
    if (!this.atLineBoundary) this.write("\n"); // terminate a crashed-mid-line write
    this.drainStderrTail();
    this.flushStderr();
    this.write(`${JSON.stringify({ type: "driver-meta", ...meta })}\n`);
    return new Promise((resolve) => {
      s.end(() => resolve());
    });
  }
}

/** Spawn one cursor-agent turn, stream-parse stdout, return a structured result. */
export function runTurn(opts: RunTurnOptions): Promise<TurnResult> {
  const args = buildAgentArgs(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const acc = newAccumulator();
    let stdoutBuf = "";
    let abortedBy: "operator" | "timeout" | null = null;
    const startedAt = Date.now();
    const tee = opts.transcriptPath ? new TranscriptTee(opts.transcriptPath) : null;

    const child = spawn(agentBin(), args, {
      cwd: opts.root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const killLadder = () => {
      // a kill before the child has a pid is silently lost — wait for spawn
      if (!child.pid) {
        child.once("spawn", killLadder);
        return;
      }
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            abortedBy ??= "timeout";
            killLadder();
          }, timeoutMs)
        : null;

    const onAbort = () => {
      abortedBy ??= "operator";
      killLadder();
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      tee?.stdout(chunk);
      stdoutBuf += chunk;
      let nl = stdoutBuf.indexOf("\n");
      while (nl >= 0) {
        applyLine(acc, stdoutBuf.slice(0, nl));
        stdoutBuf = stdoutBuf.slice(nl + 1);
        nl = stdoutBuf.indexOf("\n");
      }
    });
    // stderr is drained to avoid backpressure deadlock; teed to the transcript when on.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      tee?.stderr(chunk);
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (stdoutBuf.trim()) applyLine(acc, stdoutBuf);
      const exitCode = code ?? null;
      const terminal = abortedBy ? "aborted" : terminalFor(acc, exitCode);
      const anomaly = classifyAnomaly(acc, exitCode, abortedBy);
      const result: TurnResult = {
        sessionId: acc.sessionId,
        finalText: acc.finalText || acc.assistantText,
        usage: acc.usage,
        terminal,
        exitCode,
        timedOut: abortedBy === "timeout",
        abort: abortedBy,
        anomaly,
        rawSample: anomaly ? rawSample(acc) : undefined,
      };
      const finishTranscript =
        tee?.close({
          exit_code: exitCode,
          terminal,
          timed_out: abortedBy === "timeout",
          aborted_by: abortedBy,
          elapsed_ms: Date.now() - startedAt,
        }) ?? Promise.resolve();
      void finishTranscript.then(() => resolve(result));
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
