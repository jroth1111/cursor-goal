import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "./paths.js";
import type { TranscriptTailEvidence } from "./transcript-tail.js";

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

export type StopTraceEntry = {
  at: string;
  agent_id?: string;
  signature?: string;
  level_failed: string | null;
  failures: string[];
  pipeline_result: string;
  terminal_status?: string;
  honor_passport?: boolean;
  transcript_tail?: TranscriptTailEvidence;
  dry_run?: boolean;
  token_usage?: TokenUsage;
};

export function stopTracePath(root: string): string {
  return path.join(goalDir(root), "stop-trace.jsonl");
}

export async function appendStopTrace(root: string, entry: StopTraceEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  const file = stopTracePath(root);
  await mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
  await appendFile(file, line, "utf8").catch(() => undefined);
}

export async function readStopTraceTail(root: string, n = 20): Promise<StopTraceEntry[]> {
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const file = stopTracePath(root);
  if (n <= 0) return [];
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: StopTraceEntry[] = [];
  for (const line of lines.slice(-n)) {
    try {
      out.push(JSON.parse(line) as StopTraceEntry);
    } catch {
      continue;
    }
  }
  return out;
}

export function sumTokenUsage(entries: StopTraceEntry[]): { input: number; output: number; cache_read: number; cache_write: number } {
  let input = 0;
  let output = 0;
  let cache_read = 0;
  let cache_write = 0;
  for (const e of entries) {
    if (!e.token_usage) continue;
    input += e.token_usage.input_tokens ?? 0;
    output += e.token_usage.output_tokens ?? 0;
    cache_read += e.token_usage.cache_read_tokens ?? 0;
    cache_write += e.token_usage.cache_write_tokens ?? 0;
  }
  return { input, output, cache_read, cache_write };
}
