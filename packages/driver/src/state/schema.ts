import { Ajv, type ValidateFunction } from "ajv";

export type TaskKind = "implement" | "verify" | "integrate" | "remediate";
export type TaskStatus = "pending" | "ready" | "in_progress" | "done" | "blocked";
export type RunStatus = "intake" | "decomposed" | "running" | "done" | "escalated" | "paused";

export type Task = {
  id: string;
  title: string;
  kind: TaskKind;
  deps: string[];
  acceptance_checks: string[];
  acceptance_prose: string;
  status: TaskStatus;
  attempts: number;
  approach: string;
  last_failure: string | null;
  evidence: { proof_ptrs: string[]; tree: string | null };
};

export type TaskGraph = { tasks: Task[] };

/** What the planner returns: task identity + acceptance, before runtime fields are added. */
export type TaskDraft = Pick<
  Task,
  "id" | "title" | "kind" | "deps" | "acceptance_checks" | "acceptance_prose"
>;

export type Budgets = {
  global_turns: number;
  task_attempts: number;
  token_budget: number;
  wall_ms: number;
};

export type GoalSpec = {
  goal_text: string;
  source: "GOAL.md" | "prompt";
  acceptance_checks: string[];
  non_goals: string[];
  scope: string[];
};

export type RunState = {
  version: 1;
  goal_id: string;
  goal_spec: GoalSpec;
  status: RunStatus;
  global_turns: number;
  budgets: Budgets;
  consumed: { tokens: number; wall_ms: number };
  no_progress_streak: number;
  fingerprint_ring: string[];
  session_map: Record<string, string>;
  active_task: string | null;
  escalation_reason: string | null;
  started_at: string;
  updated_at: string;
  driver_pid: number | null;
};

export type VerdictNextActionKind = "continue" | "replan" | "switch_approach" | "escalate" | "none";

export type Verdict = {
  task_complete: boolean;
  confidence: number;
  blockers: string[];
  next_action: {
    kind: VerdictNextActionKind;
    instruction: string;
    rationale?: string;
  };
  evidence_seen?: string[];
};

const ajv = new Ajv({ allErrors: true, strict: false });

// ── Decompose output: the task graph the planner returns ───────────────────────
const taskGraphSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "kind", "deps", "acceptance_checks", "acceptance_prose"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_.-]+$" },
          title: { type: "string", minLength: 1, maxLength: 200 },
          kind: { enum: ["implement", "verify", "integrate", "remediate"] },
          deps: { type: "array", items: { type: "string" }, maxItems: 40 },
          acceptance_checks: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 12 },
          acceptance_prose: { type: "string", maxLength: 800 },
        },
      },
    },
  },
} as const;

// ── Verdict output: the per-turn judgment the ask-mode call returns ────────────
const verdictSchema = {
  type: "object",
  additionalProperties: false,
  required: ["task_complete", "confidence", "next_action", "blockers"],
  properties: {
    task_complete: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    blockers: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 8 },
    next_action: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "instruction"],
      properties: {
        kind: { enum: ["continue", "replan", "switch_approach", "escalate", "none"] },
        instruction: { type: "string", maxLength: 1200 },
        rationale: { type: "string", maxLength: 400 },
      },
    },
    evidence_seen: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 12 },
  },
} as const;

export const validateTaskGraph: ValidateFunction = ajv.compile(taskGraphSchema);
export const validateVerdict: ValidateFunction = ajv.compile(verdictSchema);

export function ajvErrorText(v: ValidateFunction): string {
  return (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim()).join("; ");
}

export const DEFAULT_BUDGETS: Budgets = {
  global_turns: 40,
  task_attempts: 4,
  token_budget: 2_000_000,
  wall_ms: 2 * 60 * 60 * 1000,
};

/** Acyclic + every dep resolvable + each non-verify task has acceptance. */
export function validateGraphSemantics(graph: TaskGraph): string | null {
  const ids = new Set(graph.tasks.map((t) => t.id));
  if (ids.size !== graph.tasks.length) return "duplicate task ids";
  for (const t of graph.tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) return `task ${t.id} depends on unknown task ${d}`;
      if (d === t.id) return `task ${t.id} depends on itself`;
    }
    if (t.kind !== "verify" && t.acceptance_checks.length === 0 && !t.acceptance_prose.trim()) {
      return `task ${t.id} has no acceptance criteria`;
    }
  }
  // cycle detection (DFS)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(graph.tasks.map((t) => [t.id, WHITE]));
  const byId = new Map(graph.tasks.map((t) => [t.id, t]));
  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const d of byId.get(id)?.deps ?? []) {
      const c = color.get(d);
      if (c === GRAY) return true;
      if (c === WHITE && visit(d)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const t of graph.tasks) {
    if (color.get(t.id) === WHITE && visit(t.id)) return `dependency cycle through ${t.id}`;
  }
  return null;
}
