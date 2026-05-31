import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ensureGoalDirs, goalDir, projectRoot } from "../lib/paths.js";
import { markEdit, gitTreeId } from "../lib/git-state.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import { extractWorkUnitId } from "../lib/work-units.js";

async function main(): Promise<void> {
  const input = await readStdinJson<{
    tool_name?: string;
    tool_output?: string;
    tool_input?: Record<string, unknown>;
    conversation_id?: string;
    exit_code?: number;
  }>();

  const root = projectRoot();
  await ensureGoalDirs(root);

  const tool = input.tool_name ?? "";
  const workUnitId =
    extractWorkUnitId(JSON.stringify(input.tool_input ?? {})) ??
    (typeof input.tool_input?.work_unit_id === "string"
      ? input.tool_input.work_unit_id
      : null);

  const isEdit = tool === "Write" || tool === "Edit" || tool === "MultiEdit";

  if (isEdit) {
    await markEdit(root);
  }

  // Only shell out to git for edit-class tools — Read/Grep/Glob don't need tree state.
  const gitHead = isEdit ? gitTreeId(root) : null;
  const line = JSON.stringify({
    at: new Date().toISOString(),
    tool,
    git_head: gitHead,
    exit_code: input.exit_code ?? 0,
    work_unit_id: workUnitId,
    conversation_id: input.conversation_id,
    excerpt: (input.tool_output ?? "").slice(0, 500),
  });

  await appendFile(path.join(goalDir(root), "evidence", "ledger.jsonl"), line + "\n", "utf8");

  if (workUnitId) {
    const unitsDir = path.join(goalDir(root), "evidence", "units");
    await mkdir(unitsDir, { recursive: true });
    await appendFile(path.join(unitsDir, `${workUnitId}.jsonl`), line + "\n", "utf8");
  }

  hookJson({});
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({ agent_message: `postToolUse warning: ${msg}; continuing fail-open` });
}
