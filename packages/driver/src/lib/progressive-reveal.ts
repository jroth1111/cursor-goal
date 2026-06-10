import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evidenceDir } from "./paths.js";

/**
 * What goes ENTIRE vs PROGRESSIVE in LLM-facing prompts:
 *
 * ENTIRE (never truncate — the agent must act on the exact text):
 *   goal, task title, acceptance check commands, acceptance prose, next_step,
 *   approach, open blockers, integrity issues, verdict steering instructions.
 *
 * PROGRESSIVE (preview + artifact pointer — bulky evidence the agent can open):
 *   tool output, check stdout/stderr, agent turn dumps, long attempt history,
 *   very long changed-file lists.
 *
 * State on disk (context.json, task-graph.json, evidence/*) always keeps the
 * full payload; truncation happens only when building a prompt.
 */

export const PREVIEW = {
  TOOL_OUTPUT_TAIL: 500,
  CHECK_FAIL: 600,
  FAILING_TAIL_TOTAL: 1500,
  VERDICT_CHECK: 400,
  VERDICT_SUMMARY: 800,
  INSTRUCT_FAILURE: 1200,
  REPLAN_FAILURE: 1200,
  HOOK_FAILURE: 800,
  HISTORY_ATTEMPTS: 3,
  /** Below this count, list every path; above, preview head + pointer to git. */
  CHANGED_FILES_INLINE: 60,
  CHANGED_FILES_HEAD: 40,
} as const;

export type ProgressiveRevealOptions = {
  maxChars: number;
  /** Keep the end of the text (default for shell/tool output). */
  tail?: boolean;
};

export type ProgressiveRevealResult = {
  preview: string;
  truncated: boolean;
  byteCount: number;
};

export function progressiveReveal(text: string, opts: ProgressiveRevealOptions): ProgressiveRevealResult {
  const byteCount = Buffer.byteLength(text, "utf8");
  if (byteCount <= opts.maxChars) {
    return { preview: text, truncated: false, byteCount };
  }
  const tail = opts.tail !== false;
  const preview = tail ? text.slice(-opts.maxChars) : text.slice(0, opts.maxChars);
  return { preview, truncated: true, byteCount };
}

/** Path relative to the project root — readable by the agent without guessing absolutes. */
export function relFromRoot(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

export function withArtifactRef(
  preview: string,
  artifactRelPath: string,
  truncated: boolean,
  byteCount: number,
): string {
  if (!truncated) return preview;
  return `${preview}\n… (${byteCount} bytes total; full output: ${artifactRelPath})`;
}

export async function writeTextArtifact(
  root: string,
  subdir: string,
  basename: string,
  content: string,
): Promise<string> {
  const dir = path.join(evidenceDir(root), subdir);
  await mkdir(dir, { recursive: true });
  const abs = path.join(dir, basename);
  await writeFile(abs, content, "utf8");
  return relFromRoot(root, abs);
}

export function revealForPrompt(
  text: string,
  opts: ProgressiveRevealOptions,
  artifactRelPath?: string,
): string {
  const { preview, truncated, byteCount } = progressiveReveal(text, opts);
  return artifactRelPath ? withArtifactRef(preview, artifactRelPath, truncated, byteCount) : preview;
}

/** Progressive failure detail for agent/planner prompts; full text lives in state + artifact. */
export function formatFailureForPrompt(full: string, artifactRelPath?: string, maxChars = PREVIEW.INSTRUCT_FAILURE): string {
  return revealForPrompt(full, { maxChars, tail: true }, artifactRelPath);
}

/** Changed paths: entire list when small; progressive pointer when the diff is huge. */
export function formatChangedFilesForPrompt(files: string[]): string {
  if (!files.length) return "";
  if (files.length <= PREVIEW.CHANGED_FILES_INLINE) return files.join(", ");
  const head = files.slice(0, PREVIEW.CHANGED_FILES_HEAD).join(", ");
  return `${head}, … and ${files.length - PREVIEW.CHANGED_FILES_HEAD} more (${files.length} total; run \`git diff --name-only\` for the full list)`;
}

/** Stable filename for a tool-use evidence artifact. */
export function toolOutputBasename(toolUseId: string | undefined): string {
  const safe = (toolUseId ?? `anon-${Date.now()}`).replace(/[^A-Za-z0-9_.-]+/g, "_");
  return `${safe}.txt`;
}

export const PROOF_RUNS_ARTIFACT = ".cursor/goal/driver/evidence/proof-runs.jsonl";

export async function writeTurnFailureArtifact(
  root: string,
  taskId: string,
  turn: number,
  content: string,
): Promise<string> {
  const safeId = taskId.replace(/[^A-Za-z0-9_.-]+/g, "_");
  return writeTextArtifact(root, "turn-failures", `${safeId}-turn${turn}.txt`, content);
}

/** Full failing-check transcript for persistence; progressive only when re-injected. */
export function formatCheckFailuresFull(results: Array<{ cmd: string; output?: string }>): string {
  return results.map((r) => `$ ${r.cmd}\n${r.output ?? ""}`).join("\n---\n");
}
