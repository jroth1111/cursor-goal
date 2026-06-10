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
    "Aim for a PRODUCTION-QUALITY result, not the minimum that passes the checks above.",
    "Decompose so the finished work has:",
    "- tests that exercise the REAL entry point (CLI/API/real I/O), not mocks of owned code,",
    "  and assert user-visible outcomes/contracts rather than internal details;",
    "- explicit coverage of edge & failure cases (empty/boundary/malformed/oversized input,",
    "  error paths that fail gracefully with clear messages), not just the happy path;",
    "- correct behavior under realistic input size (no unbounded memory or O(n^2) hot paths);",
    "- complete, runnable usage docs.",
    "Include explicit tasks for tests, edge-case/error hardening, and documentation even if the",
    "goal didn't name them.",
    "",
    "Rules:",
    "- Use as many tasks as the goal genuinely warrants — one coherent deliverable, behavior,",
    "  edge-case-hardening concern, test module, or doc per task. There is NO small target:",
    "  a large goal should produce a large plan. Do not pad with trivial steps, and do not cram",
    "  unrelated work into one task. Each task is a unit a single focused agent turn can attempt.",
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
        title: spec.goal_text,
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
        last_failure_artifact: null,
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
  for (let attempt = 0; attempt < 4; attempt++) {
    const note =
      attempt === 0
        ? ""
        : `\n\nYour previous response was not a valid task graph (${lastErr}). Return ONLY the JSON object.`;
    let result: TurnResult;
    try {
      result = await call({
        instruction: decomposePrompt(spec) + note,
        // ask mode (read-only Q&A) obeys "return ONLY JSON"; plan mode narrates an
        // exploration and returns no JSON, which silently forced the single-task fallback.
        mode: "ask",
        root,
        timeoutMs: 10 * 60 * 1000,
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
