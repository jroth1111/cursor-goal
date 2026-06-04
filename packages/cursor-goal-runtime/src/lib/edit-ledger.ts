import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { goalDir, readJson } from "./paths.js";
import { isGoalArtifactPath } from "./git-state.js";

export type EditLedgerEntry = {
  at: string;
  tool: string;
  file_path: string;
  conversation_id?: string;
  work_unit_id?: string;
};

export type ToolEditInput = {
  tool_name?: string;
  file_path?: unknown;
  path?: unknown;
  tool_input?: Record<string, unknown>;
  conversation_id?: string;
  work_unit_id?: string;
};

export function editLedgerPath(root: string): string {
  return path.join(goalDir(root), "evidence", "edits.jsonl");
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeRootRelative(root: string, filePath: string): string | null {
  const raw = filePath.trim();
  if (!raw) return null;

  const rootAbs = path.resolve(root);
  const targetAbs = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(rootAbs, raw);
  const rel = normalizeSlash(path.relative(rootAbs, targetAbs));
  if (!rel || rel === ".") return ".";
  if (rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    return normalizeSlash(raw);
  }
  return rel;
}

export function extractEditedPath(input: ToolEditInput): string | null {
  const value =
    input.file_path ??
    input.path ??
    input.tool_input?.file_path ??
    input.tool_input?.path;
  return typeof value === "string" && value.trim() ? value : null;
}

export async function recordEditPath(
  root: string,
  input: ToolEditInput,
  workUnitId?: string | null,
): Promise<void> {
  const raw = extractEditedPath(input);
  if (!raw) return;
  const filePath = normalizeRootRelative(root, raw);
  if (!filePath) return;

  const line = JSON.stringify({
    at: new Date().toISOString(),
    tool: input.tool_name ?? "",
    file_path: filePath,
    conversation_id: input.conversation_id,
    work_unit_id: workUnitId ?? input.work_unit_id,
  } satisfies EditLedgerEntry);
  const file = editLedgerPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${line}\n`, "utf8");
}

async function compiledAtMs(root: string): Promise<number | null> {
  const manifest = await readJson<{ compiled_at?: unknown }>(
    path.join(goalDir(root), "manifest.json"),
  ).catch(() => null);
  if (typeof manifest?.compiled_at !== "string") return null;
  const n = Date.parse(manifest.compiled_at);
  return Number.isFinite(n) ? n : null;
}

export async function listRecentEditedFiles(root: string): Promise<string[]> {
  const file = editLedgerPath(root);
  if (!existsSync(file)) return [];

  const cutoff = await compiledAtMs(root);
  const out = new Set<string>();
  const text = await readFile(file, "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: Partial<EditLedgerEntry>;
    try {
      entry = JSON.parse(line) as Partial<EditLedgerEntry>;
    } catch {
      continue;
    }
    if (typeof entry.file_path !== "string" || !entry.file_path.trim()) {
      continue;
    }
    if (cutoff !== null) {
      const at = typeof entry.at === "string" ? Date.parse(entry.at) : NaN;
      if (Number.isFinite(at) && at < cutoff) continue;
    }
    const rel = normalizeSlash(entry.file_path);
    if (isGoalArtifactPath(rel) || rel === "GOAL.md") continue;
    out.add(rel);
  }
  return [...out];
}

export async function countRecentEdits(root: string, sinceMs?: number): Promise<number> {
  const file = editLedgerPath(root);
  if (!existsSync(file)) return 0;
  const cutoff = sinceMs ?? (await compiledAtMs(root));
  let count = 0;
  const text = await readFile(file, "utf8").catch(() => "");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: Partial<EditLedgerEntry>;
    try {
      entry = JSON.parse(line) as Partial<EditLedgerEntry>;
    } catch {
      continue;
    }
    if (cutoff != null) {
      const at = typeof entry.at === "string" ? Date.parse(entry.at) : NaN;
      if (Number.isFinite(at) && at < cutoff) continue;
    }
    count += 1;
  }
  return count;
}
