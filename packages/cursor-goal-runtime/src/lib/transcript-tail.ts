import { stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export type TranscriptTailEvidence = {
  path: string;
  line_count: number;
  byte_count: number;
  prior_governance_followup: boolean;
  truncated: boolean;
};

const MAX_TRANSCRIPT_BYTES = 128 * 1024;
const MAX_LINES = 80;

export async function readTranscriptTailEvidence(
  transcriptPath?: string | null,
): Promise<TranscriptTailEvidence | undefined> {
  if (!transcriptPath || !existsSync(transcriptPath)) return undefined;
  const s = await stat(transcriptPath).catch(() => null);
  if (!s?.isFile()) return undefined;
  const byteCount = s.size;
  const raw = await readFile(transcriptPath, "utf8");
  const slice = raw.slice(Math.max(0, raw.length - MAX_TRANSCRIPT_BYTES));
  const lines = slice.split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-MAX_LINES);
  return {
    path: transcriptPath,
    line_count: lines.length,
    byte_count: byteCount,
    prior_governance_followup: tail.some((line) =>
      /\[governance\]|stop_sig=|cursor-goal stop/i.test(line),
    ),
    truncated: raw.length > slice.length || lines.length > tail.length,
  };
}
