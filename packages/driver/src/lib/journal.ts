import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { journalPath } from "./paths.js";

/** One row in the append-only run journal — the durable record of every turn and decision. */
export type JournalEntry = {
  at: string;
  kind: "turn" | "decision" | "escalation" | "replan" | "lifecycle";
  task_id?: string;
  global_turn?: number;
  terminal?: string;
  decision?: string;
  checks_pass?: boolean;
  progressed?: boolean;
  note?: string;
  tokens?: number;
  /** repo-relative path to the turn's full NDJSON transcript under evidence/turns/. */
  transcript?: string;
};

export async function appendJournal(root: string, entry: JournalEntry): Promise<void> {
  const file = journalPath(root);
  await mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8").catch(() => undefined);
}

export async function readJournalTail(root: string, n = 20): Promise<JournalEntry[]> {
  const file = journalPath(root);
  if (n <= 0 || !existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: JournalEntry[] = [];
  for (const line of lines.slice(-n)) {
    try {
      out.push(JSON.parse(line) as JournalEntry);
    } catch {
      continue;
    }
  }
  return out;
}
