/**
 * Folds cursor-agent's headless NDJSON (`--output-format stream-json`) into a
 * running summary. Every event carries `session_id`; the final event is
 * `{type:"result", subtype:"success"|..., result, session_id, request_id, usage}`.
 * Confirmed against decompiled headless.ts:798-847.
 */

export type StreamUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

/** Raw-line sample bounds (head + tail) kept for drift diagnostics. */
const RAW_SAMPLE = 3;

export type StreamAccumulator = {
  sessionId: string | null;
  finalText: string;
  resultSeen: boolean;
  resultSubtype: string | null;
  isError: boolean;
  usage: StreamUsage | null;
  assistantText: string;
  /** contract evidence: how many lines arrived and what shapes they had. */
  rawCount: number;
  rawHead: string[];
  rawTail: string[];
  eventTypes: Record<string, number>;
};

export function newAccumulator(): StreamAccumulator {
  return {
    sessionId: null,
    finalText: "",
    resultSeen: false,
    resultSubtype: null,
    isError: false,
    usage: null,
    assistantText: "",
    rawCount: 0,
    rawHead: [],
    rawTail: [],
    eventTypes: {},
  };
}

function pickUsage(raw: Record<string, unknown>): StreamUsage | null {
  const u = raw.usage as Record<string, unknown> | undefined;
  if (!u || typeof u !== "object") return null;
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  return {
    input_tokens: num(u.input_tokens) ?? num(u.inputTokens),
    output_tokens: num(u.output_tokens) ?? num(u.outputTokens),
    cache_read_tokens: num(u.cache_read_tokens) ?? num(u.cacheReadTokens),
    cache_write_tokens: num(u.cache_write_tokens) ?? num(u.cacheWriteTokens),
  };
}

function textFrom(raw: Record<string, unknown>): string {
  if (typeof raw.text === "string") return raw.text;
  if (typeof raw.delta === "string") return raw.delta;
  const msg = raw.message as Record<string, unknown> | undefined;
  if (msg && typeof msg.text === "string") return msg.text;
  return "";
}

/** Apply one NDJSON line to the accumulator. Unparseable lines are ignored
 *  (but sampled — garbage is exactly the evidence drift diagnostics need). */
export function applyLine(acc: StreamAccumulator, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  acc.rawCount += 1;
  if (acc.rawHead.length < RAW_SAMPLE) acc.rawHead.push(trimmed);
  else {
    acc.rawTail.push(trimmed);
    if (acc.rawTail.length > RAW_SAMPLE) acc.rawTail.shift();
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    acc.eventTypes["(unparseable)"] = (acc.eventTypes["(unparseable)"] ?? 0) + 1;
    return;
  }
  const typeName = typeof raw.type === "string" && raw.type ? raw.type : "(untyped)";
  acc.eventTypes[typeName] = (acc.eventTypes[typeName] ?? 0) + 1;

  const sid =
    (typeof raw.session_id === "string" && raw.session_id) ||
    (typeof raw.sessionId === "string" && (raw.sessionId as string)) ||
    null;
  if (sid && !acc.sessionId) acc.sessionId = sid;

  const usage = pickUsage(raw);
  if (usage) acc.usage = usage;

  const type = typeof raw.type === "string" ? raw.type : "";
  if (type === "result") {
    acc.resultSeen = true;
    acc.resultSubtype = typeof raw.subtype === "string" ? raw.subtype : null;
    acc.isError = raw.is_error === true || acc.resultSubtype === "error";
    if (typeof raw.result === "string") acc.finalText = raw.result;
  } else if (type === "assistant" || type === "text" || type === "message") {
    acc.assistantText += textFrom(raw);
  } else if (type === "error") {
    acc.isError = true;
  }
}

export type TurnTerminal = "success" | "error" | "aborted";

export function terminalFor(acc: StreamAccumulator, exitCode: number | null): TurnTerminal {
  if (acc.isError) return "error";
  if (acc.resultSeen && acc.resultSubtype === "success" && exitCode === 0) return "success";
  if (exitCode !== 0 && exitCode !== null) return "error";
  if (!acc.resultSeen) return "aborted";
  return acc.resultSubtype === "success" ? "success" : "error";
}

export type StreamAnomaly = { kind: "no-result-event" | "missing-session-id"; detail: string };

function typeSummary(acc: StreamAccumulator): string {
  const entries = Object.entries(acc.eventTypes);
  return entries.length ? entries.map(([t, n]) => `${t}×${n}`).join(", ") : "(no lines)";
}

/**
 * Detect "the stream did not look like cursor-agent's documented contract" —
 * distinct from "the agent failed". Deliberately conservative: an operator stop,
 * a watchdog timeout, or a nonzero exit (a crash) is NEVER drift; only a clean
 * exit whose stream is missing required contract elements qualifies. Without
 * this, a cursor-agent update that changes the stream shape burns the whole
 * attempt ladder as inexplicable "agent failures". The kill exclusion is part
 * of THIS signature so no caller can forget to gate it.
 */
export function classifyAnomaly(
  acc: StreamAccumulator,
  exitCode: number | null,
  abortedBy: "operator" | "timeout" | null = null,
): StreamAnomaly | null {
  if (abortedBy) return null; // a kill truncates the stream by design — never drift
  if (exitCode !== 0) return null; // crashes are plain errors, not drift
  if (!acc.resultSeen) {
    return {
      kind: "no-result-event",
      detail: `cursor-agent exited 0 but emitted no result event (${acc.rawCount} line(s); types: ${typeSummary(acc)})`,
    };
  }
  if (acc.rawCount > 0 && !acc.sessionId) {
    return {
      kind: "missing-session-id",
      detail: `no event carried a session_id — --resume continuation is impossible for this session (types: ${typeSummary(acc)})`,
    };
  }
  return null;
}

/** First/last raw lines for failure artifacts — what the stream actually said. */
export function rawSample(acc: StreamAccumulator): string[] {
  const omitted = acc.rawCount - acc.rawHead.length - acc.rawTail.length;
  return [
    ...acc.rawHead,
    ...(omitted > 0 ? [`… ${omitted} line(s) omitted …`] : []),
    ...acc.rawTail,
  ];
}
