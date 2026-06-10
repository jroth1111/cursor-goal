import { extractJsonObject } from "../lib/json-extract.js";
import { runTurn, type RunTurnOptions, type TurnResult } from "../agent/runner.js";
import {
  ajvErrorText,
  validateGraphSemantics,
  validateTaskGraph,
  type GoalSpec,
  type TaskGraph,
} from "../state/schema.js";

export type AgentCall = (opts: RunTurnOptions) => Promise<TurnResult>;

function decomposePrompt(spec: GoalSpec): string {
  const checks = spec.acceptance_checks.length
    ? spec.acceptance_checks.map((c) => `  - \`${c}\``).join("\n")
    : "  (none provided — propose concrete, runnable acceptance per task)";
  const scope = spec.scope.length ? spec.scope.join(", ") : "(unspecified)";
  const nonGoals = spec.non_goals.length ? spec.non_goals.join("; ") : "(none)";
  return [
    "You are the planning brain for an autonomous coding driver. Decompose the GOAL",
    "into an ordered task graph that, when every task's acceptance holds, fully realizes the goal.",
    "",
    `GOAL: ${spec.goal_text}`,
    `SCOPE (paths the work should stay within): ${scope}`,
    `NON-GOALS: ${nonGoals}`,
    "GOAL-LEVEL ACCEPTANCE CHECKS (shell commands that must exit 0):",
    checks,
    "",
    "Rules:",
    "- 1 to ~12 tasks. Each task is a unit of work a single agent turn can plausibly attempt.",
    "- Order via deps (ids of prerequisite tasks). The graph must be acyclic.",
    "- kind is one of: implement | verify | integrate | remediate.",
    "- Every non-verify task needs acceptance: prefer acceptance_checks (runnable shell commands);",
    "  use acceptance_prose only when no command can decide it.",
    "- ids are short slugs matching ^[A-Za-z0-9_.-]+$.",
    "",
    "Respond with ONLY this JSON object, no prose, no code fence:",
    '{"tasks":[{"id":"t1","title":"...","kind":"implement","deps":[],"acceptance_checks":["..."],"acceptance_prose":"..."}]}',
  ].join("\n");
}

function coerceGraph(value: unknown): TaskGraph | null {
  if (!validateTaskGraph(value)) return null;
  const graph = value as TaskGraph;
  // normalize optional fields the schema allows to be omitted
  for (const t of graph.tasks) {
    t.deps = t.deps ?? [];
    t.acceptance_checks = t.acceptance_checks ?? [];
    t.acceptance_prose = t.acceptance_prose ?? "";
  }
  if (validateGraphSemantics(graph)) return null;
  return graph;
}

/** Single-task fallback so a flaky planner never blocks the run entirely. */
export function fallbackGraph(spec: GoalSpec): TaskGraph {
  return {
    tasks: [
      {
        id: "goal",
        title: spec.goal_text.slice(0, 120),
        kind: "implement",
        deps: [],
        acceptance_checks: spec.acceptance_checks,
        acceptance_prose: spec.acceptance_checks.length
          ? ""
          : "Goal is satisfied per the GOAL description.",
        status: "pending",
        attempts: 0,
        approach: "default",
        last_failure: null,
        evidence: { proof_ptrs: [], tree: null },
      },
    ],
  };
}

export type DecomposeResult = { graph: TaskGraph; source: "planner" | "fallback"; error?: string };

/** Ask a plan-mode cursor-agent to produce a validated task graph; fall back on failure. */
export async function decompose(
  spec: GoalSpec,
  root: string,
  call: AgentCall = runTurn,
): Promise<DecomposeResult> {
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const note =
      attempt === 0
        ? ""
        : `\n\nYour previous response was not a valid task graph (${lastErr}). Return ONLY the JSON object.`;
    let result: TurnResult;
    try {
      result = await call({
        instruction: decomposePrompt(spec) + note,
        mode: "plan",
        root,
        timeoutMs: 5 * 60 * 1000,
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
    const obj = extractJsonObject(result.finalText);
    if (!obj) {
      lastErr = "no JSON object found in response";
      continue;
    }
    const graph = coerceGraph(obj);
    if (!graph) {
      lastErr = validateTaskGraph(obj)
        ? validateGraphSemantics(obj as TaskGraph) ?? "semantic check failed"
        : ajvErrorText(validateTaskGraph);
      continue;
    }
    return { graph, source: "planner" };
  }
  return { graph: fallbackGraph(spec), source: "fallback", error: lastErr };
}
