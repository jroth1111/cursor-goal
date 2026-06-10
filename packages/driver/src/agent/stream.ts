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

export type StreamAccumulator = {
  sessionId: string | null;
  finalText: string;
  resultSeen: boolean;
  resultSubtype: string | null;
  isError: boolean;
  usage: StreamUsage | null;
  assistantText: string;
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

/** Apply one NDJSON line to the accumulator. Unparseable lines are ignored. */
export function applyLine(acc: StreamAccumulator, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return;
  }

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
