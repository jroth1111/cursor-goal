import { existsSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { journalPath } from "../lib/paths.js";
import type { JournalEntry } from "../lib/journal.js";

export type LogsOptions = {
  task?: string;
  kind?: string;
  tail?: number;
  follow?: boolean;
  /** follow-mode poll interval; injectable so tests stay fast. */
  pollMs?: number;
  /** stops follow mode; the CLI runs without one (Ctrl-C exits the process). */
  signal?: AbortSignal;
};

const KNOWN_KINDS = new Set(["turn", "decision", "escalation", "replan", "lifecycle"]);

function timeOf(at: unknown): string {
  return typeof at === "string" && at.length >= 19 ? at.slice(11, 19) : "??:??:??";
}

/**
 * One journal line → one human line. Malformed JSON and unknown kinds are shown
 * raw with a marker — the reader must render every journal the driver ever wrote,
 * including kinds added after this code shipped.
 */
export function formatJournalLine(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let e: JournalEntry & Record<string, unknown>;
  try {
    e = JSON.parse(trimmed) as JournalEntry & Record<string, unknown>;
  } catch {
    return `??:??:??  raw        ${trimmed}`;
  }
  const t = timeOf(e.at);
  const kind = typeof e.kind === "string" ? e.kind : "unknown";
  const task = e.task_id ? ` ${e.task_id}` : "";
  if (!KNOWN_KINDS.has(kind)) {
    return `${t}  ${kind.padEnd(10)}${task} ${trimmed}`;
  }
  switch (kind) {
    case "turn": {
      const turn = e.global_turn != null ? `#${e.global_turn} ` : "";
      const term = e.terminal ? `[${e.terminal}] ` : "";
      const prog = e.progressed === true ? "changed " : e.progressed === false ? "no-change " : "";
      const tok = typeof e.tokens === "number" && e.tokens > 0 ? `tok=${e.tokens} ` : "";
      return `${t}  turn      ${task} ${turn}${term}${prog}${tok}${e.note ?? ""}`.trimEnd();
    }
    case "decision":
      return `${t}  decision  ${task} ${e.decision ?? "?"} — ${e.note ?? ""}`.trimEnd();
    default:
      return `${t}  ${kind.padEnd(10)}${task} ${e.note ?? ""}`.trimEnd();
  }
}

function passesFilter(raw: string, opts: LogsOptions): boolean {
  if (!opts.task && !opts.kind) return true;
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false; // malformed lines can't match a filter
  }
  if (opts.task && e.task_id !== opts.task) return false;
  if (opts.kind && e.kind !== opts.kind) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read (and optionally follow) the run journal, writing formatted lines via
 * `write`. The journal is append-only and written atomically per line, so
 * follow mode only ever sees at most one trailing partial line, which is
 * buffered until its newline arrives.
 */
export async function runLogs(
  root: string,
  opts: LogsOptions,
  write: (line: string) => void,
): Promise<void> {
  const file = journalPath(root);
  if (!existsSync(file)) {
    write("No driver journal in this repo.\n");
    return;
  }

  const text = await readFile(file, "utf8");
  let lines = text.split("\n").filter((l) => l.trim());
  lines = lines.filter((l) => passesFilter(l, opts));
  // slice(-0) would be slice(0) — the whole journal instead of none
  if (opts.tail != null && opts.tail >= 0) lines = opts.tail === 0 ? [] : lines.slice(-opts.tail);
  for (const l of lines) {
    const out = formatJournalLine(l);
    if (out) write(`${out}\n`);
  }
  if (!opts.follow) return;

  let pos = Buffer.byteLength(text);
  let buf = "";
  const pollMs = opts.pollMs ?? 1000;
  while (!opts.signal?.aborted) {
    await sleep(pollMs);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      continue; // journal momentarily gone (reset); keep polling
    }
    if (size < pos) {
      // the journal was replaced (reset + new run): rebase to its start instead
      // of waiting for the new file to outgrow a stale byte offset
      pos = 0;
      buf = "";
    }
    if (size <= pos) continue;
    const fh = await open(file, "r");
    try {
      const len = size - pos;
      const chunk = Buffer.alloc(len);
      await fh.read(chunk, 0, len, pos);
      pos = size;
      buf += chunk.toString("utf8");
    } finally {
      await fh.close();
    }
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line.trim() || !passesFilter(line, opts)) continue;
      const out = formatJournalLine(line);
      if (out) write(`${out}\n`);
    }
  }
}
