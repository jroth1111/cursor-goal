/**
 * afterAgentResponse hook — fire-and-forget turn journal with scope-drift detection.
 *
 * cursor-agent fires this after each agent turn completes. The response is
 * ignored, so this hook never blocks the agent. It appends a lightweight
 * entry to evidence/turns.jsonl for use by oscillation detection (Stage 2)
 * and operator analytics.
 *
 * After journaling, checks last 3 edit-ledger entries against compiled scope.
 * If all 3 are out of scope, writes .alignment-warning marker for
 * beforeSubmitPrompt to consume (one-shot).
 */
import { appendFile, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureGoalDirs, goalDir, projectRoot, readJson } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import { resolveAgentId } from "../lib/runtime-state.js";
import type { EditLedgerEntry } from "../lib/edit-ledger.js";

type AfterAgentResponseInput = {
  conversation_id?: string;
  generation_id?: string;
  model?: string;
  text?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pathInScope(filePath: string, scope: string[]): boolean {
  if (scope.length === 0) return true;
  const norm = normalize(filePath);
  return scope.some((s) => {
    const base = normalize(s);
    if (base === "." || base === "" || base === "**") return true;
    return norm === base || norm.startsWith(`${base}/`);
  });
}

async function checkScopeDrift(root: string): Promise<void> {
  const scope = await readJson<{ paths?: string[] }>(
    path.join(goalDir(root), "scope.json"),
  ).catch(() => null);
  const paths = scope?.paths;
  if (!paths || paths.length === 0) return;

  const editFile = path.join(goalDir(root), "evidence", "edits.jsonl");
  if (!existsSync(editFile)) return;

  const raw = await readFile(editFile, "utf8").catch(() => "");
  const lines = raw.split("\n").filter(Boolean);
  const recent: EditLedgerEntry[] = [];
  for (const line of lines.reverse()) {
    if (recent.length >= 3) break;
    try {
      recent.push(JSON.parse(line) as EditLedgerEntry);
    } catch {
      continue;
    }
  }

  if (recent.length < 3) return;
  const allOutOfScope = recent.every(
    (e) => e.file_path && !pathInScope(e.file_path, paths),
  );

  const marker = path.join(goalDir(root), ".alignment-warning");
  if (allOutOfScope) {
    await writeFile(marker, new Date().toISOString(), "utf8").catch(() => undefined);
  } else if (existsSync(marker)) {
    await unlink(marker).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const input = await readStdinJson<AfterAgentResponseInput>();
  const root = projectRoot();
  await ensureGoalDirs(root);

  const agentId = resolveAgentId(input);
  const evidenceDir = path.join(goalDir(root), "evidence");
  await mkdir(evidenceDir, { recursive: true }).catch(() => undefined);

  const entry = {
    at: new Date().toISOString(),
    agent_id: agentId,
    conversation_id: input.conversation_id,
    model: input.model,
    text_length: input.text?.length ?? 0,
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
  };

  await appendFile(
    path.join(evidenceDir, "turns.jsonl"),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  ).catch(() => undefined);

  // Scope-drift detection — fire-and-forget, never blocks.
  await checkScopeDrift(root).catch(() => undefined);

  hookJson({});
}

try {
  await main();
} catch {
  // afterAgentResponse must never throw — fire-and-forget.
  hookJson({});
}
