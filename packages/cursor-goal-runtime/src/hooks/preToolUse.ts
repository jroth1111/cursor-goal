import { projectRoot } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import {
  extractWorkUnitId,
  isSubagentContext,
  isUnitEvidencePath,
  markUnitInProgress,
  pathTouchesGoalGovernance,
} from "../lib/work-units.js";
import { checkShellGate } from "../lib/shell-allow.js";
import { isToolGovernancePassthrough } from "../lib/governance-active.js";
import { resolveAgentId } from "../lib/runtime-state.js";
import {
  checkSubagentWriteGate,
  resolveSubagentUnitId,
} from "../lib/subagent-write-gate.js";

const input = await readStdinJson<{
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  command?: string;
  file_path?: string;
  conversation_id?: string;
  work_unit_id?: string;
  is_subagent?: boolean;
}>();

const root = projectRoot();
const tool = input.tool_name ?? "";
const subagent = isSubagentContext(input as Record<string, unknown>);
const filePath =
  (input.file_path as string) ??
  (input.tool_input?.path as string) ??
  (input.tool_input?.file_path as string) ??
  "";

if (tool === "Shell" || tool === "Bash") {
  const cmd = String(input.command ?? input.tool_input?.command ?? "");
  const gate = await checkShellGate(cmd, root);
  if (!gate.allowed) {
    hookJson({ permission: "deny", agent_message: gate.reason });
    process.exit(0);
  }
}

// Subagent isolation is a safety gate, not governance ceremony. Keep it active
// even when chat passthrough would otherwise allow tools.
if (filePath && pathTouchesGoalGovernance(filePath) && subagent) {
  const unitId = resolveSubagentUnitId(input as Record<string, unknown>, filePath);
  if (unitId && isUnitEvidencePath(filePath, unitId)) {
    hookJson({ permission: "allow" });
    process.exit(0);
  }
  hookJson({
    permission: "deny",
    agent_message:
      "Subagents may not write .cursor/goal governance files. Only evidence/units/<work_unit_id>.jsonl",
  });
  process.exit(0);
}

if ((tool === "Write" || tool === "Edit" || tool === "MultiEdit") && filePath && subagent) {
  const unitId = resolveSubagentUnitId(input as Record<string, unknown>, filePath);
  let gate: Awaited<ReturnType<typeof checkSubagentWriteGate>>;
  try {
    gate = await checkSubagentWriteGate(filePath, unitId, root);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    hookJson({
      permission: "deny",
      agent_message: `Subagent WriteGate: cannot verify unit scope (${msg})`,
    });
    process.exit(0);
  }
  if (!gate.allowed) {
    hookJson({ permission: "deny", agent_message: gate.reason });
    process.exit(0);
  }
}

try {
  if (await isToolGovernancePassthrough(root, resolveAgentId(input.conversation_id))) {
    hookJson({ permission: "allow" });
    process.exit(0);
  }
} catch {
  /* Malformed governance state must not turn preToolUse into a permission wall. */
}

if (tool === "Task" || tool === "task" || tool === "Subagent") {
  const prompt = String(input.tool_input?.prompt ?? input.tool_input?.description ?? "");
  const unitId = extractWorkUnitId(prompt);
  const subagentId = String(
    input.tool_input?.subagent_id ?? input.conversation_id ?? "subagent",
  );
  if (unitId) {
    await markUnitInProgress(unitId, subagentId, root).catch(() => undefined);
  }
}

hookJson({ permission: "allow" });
