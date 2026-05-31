import { appendFile } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "./paths.js";

export type StopTraceEntry = {
  at: string;
  level_failed: string | null;
  failures: string[];
  pipeline_result: string;
  dry_run?: boolean;
};

export function stopTracePath(root: string): string {
  return path.join(goalDir(root), "stop-trace.jsonl");
}

export async function appendStopTrace(root: string, entry: StopTraceEntry): Promise<void> {
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(stopTracePath(root), line, "utf8").catch(() => undefined);
}

export async function readStopTraceTail(root: string, n = 20): Promise<StopTraceEntry[]> {
  const { readFile } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const file = stopTracePath(root);
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
