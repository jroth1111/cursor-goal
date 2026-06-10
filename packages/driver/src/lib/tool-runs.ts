import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { evidenceDir } from "./paths.js";
import { PREVIEW, progressiveReveal, withArtifactRef } from "./progressive-reveal.js";

/** One row from evidence/tool-runs.jsonl (written by the postToolUse hook). */
export type ToolRunRow = {
  at: string;
  tool_name?: string;
  tool_use_id?: string;
  cwd?: string;
  duration?: number;
  output_bytes?: number;
  truncated?: boolean;
  output_artifact?: string;
  output_tail?: string;
};

export const TOOL_RUNS_INDEX = ".cursor/goal/driver/evidence/tool-runs.jsonl";

function toolRunsPath(root: string): string {
  return path.join(evidenceDir(root), "tool-runs.jsonl");
}

/** Hook-captured tool runs whose timestamp falls on or after the turn started. */
export async function readToolRunsSince(root: string, sinceMs: number): Promise<ToolRunRow[]> {
  const file = toolRunsPath(root);
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const rows: ToolRunRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as ToolRunRow;
      const at = Date.parse(row.at);
      if (Number.isFinite(at) && at >= sinceMs) rows.push(row);
    } catch {
      /* ignore corrupt lines */
    }
  }
  return rows;
}

export function toolRunArtifactPaths(rows: ToolRunRow[]): string[] {
  const paths = rows.map((r) => r.output_artifact).filter((p): p is string => Boolean(p));
  return [...new Set(paths)];
}

export function mergeProofPtrs(existing: string[], rows: ToolRunRow[]): string[] {
  return [...new Set([...existing, ...toolRunArtifactPaths(rows)])];
}

/** Progressive preview of hook-captured tool output for the verdict prompt. */
function formatToolRunBody(r: ToolRunRow): string {
  const tail = r.output_tail ?? "";
  if (!r.output_artifact) return tail;
  const revealed = progressiveReveal(tail, { maxChars: PREVIEW.TOOL_OUTPUT_TAIL, tail: true });
  if (revealed.truncated) {
    return withArtifactRef(revealed.preview, r.output_artifact, true, revealed.byteCount);
  }
  return tail ? `${tail}\n(full output: ${r.output_artifact})` : `(full output: ${r.output_artifact})`;
}

export function formatToolRunsForVerdict(rows: ToolRunRow[]): string {
  if (!rows.length) return "  (no hook-captured tool runs this turn)";
  return rows
    .map((r) => {
      const head = `  - ${r.tool_name ?? "tool"}${r.tool_use_id ? ` (${r.tool_use_id})` : ""}${
        typeof r.duration === "number" ? `, ${r.duration}ms` : ""
      }`;
      const body = formatToolRunBody(r);
      return body ? `${head}:\n      ${body.replace(/\n/g, "\n      ")}` : head;
    })
    .join("\n");
}
