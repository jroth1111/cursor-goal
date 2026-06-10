import { extractJsonObject } from "../lib/json-extract.js";
import { runTurn } from "../agent/runner.js";
import { validateTaskGraph, type GoalSpec, type Task, type TaskGraph } from "../state/schema.js";
import type { AgentCall } from "./decompose.js";
import { formatFailureForPrompt } from "../lib/progressive-reveal.js";

function replanPrompt(spec: GoalSpec, task: Task, reason: string): string {
  return [
    "You are the planning brain for an autonomous coding driver. A task is stuck and",
    "must be broken into smaller subtasks that, once all complete, satisfy it.",
    "",
    `GOAL: ${spec.goal_text}`,
    `STUCK TASK (${task.id}): ${task.title}`,
    task.acceptance_checks.length
      ? `Its acceptance checks:\n${task.acceptance_checks.map((c) => `  - \`${c}\``).join("\n")}`
      : "",
    task.acceptance_prose ? `Its acceptance (prose): ${task.acceptance_prose}` : "",
    `Why it is stuck: ${reason}`,
    task.last_failure
      ? `Last failure: ${formatFailureForPrompt(task.last_failure, task.last_failure_artifact ?? undefined)}`
      : "",
    "",
    "Return smaller subtasks — as many as needed. Each needs runnable acceptance_checks where possible.",
    "Subtask ids are short slugs. They will run before the parent task is re-attempted.",
    "",
    "Respond with ONLY this JSON object, no prose:",
    '{"tasks":[{"id":"sub1","title":"...","kind":"implement","deps":[],"acceptance_checks":["..."],"acceptance_prose":"..."}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Replace a stuck task's work with generated subtasks. The parent task is kept as
 * an integration gate that now depends on every new subtask, so existing dependents
 * need no rewiring. Returns a new graph, or null if the planner can't help.
 */
export async function replanTask(
  graph: TaskGraph,
  task: Task,
  reason: string,
  spec: GoalSpec,
  root: string,
  call: AgentCall = runTurn,
): Promise<TaskGraph | null> {
  let result;
  try {
    result = await call({
      instruction: replanPrompt(spec, task, reason),
      // ask mode reliably returns JSON; plan mode narrates instead (see decompose.ts).
      mode: "ask",
      root,
      timeoutMs: 10 * 60 * 1000,
    });
  } catch {
    return null;
  }
  const obj = extractJsonObject(result.finalText);
  if (!obj || !validateTaskGraph(obj)) return null;
  const sub = (obj as TaskGraph).tasks;
  if (!sub.length) return null;

  const existingIds = new Set(graph.tasks.map((t) => t.id));
  const newTasks: Task[] = [];
  const newIds: string[] = [];
  for (const s of sub) {
    let id = `${task.id}.${s.id}`;
    if (existingIds.has(id)) id = `${task.id}.${newTasks.length + 1}`;
    existingIds.add(id);
    newIds.push(id);
    newTasks.push({
      id,
      title: s.title,
      kind: s.kind,
      deps: [],
      acceptance_checks: s.acceptance_checks ?? [],
      acceptance_prose: s.acceptance_prose ?? "",
      status: "pending",
      attempts: 0,
      approach: "default",
      last_failure: null,
      last_failure_artifact: null,
      evidence: { proof_ptrs: [], tree: null },
    });
  }

  const tasks = graph.tasks.map((t) => {
    if (t.id !== task.id) return t;
    return {
      ...t,
      kind: "integrate" as const,
      deps: [...new Set([...t.deps, ...newIds])],
      status: "pending" as const,
      attempts: 0,
      last_failure: null,
      last_failure_artifact: null,
    };
  });

  return { tasks: [...newTasks, ...tasks] };
}
