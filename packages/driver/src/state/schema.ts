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
  last_failure_artifact: string | null;
  evidence: { proof_ptrs: string[]; tree: string | null };
};

export type TaskGraph = { tasks: Task[] };

/** What the planner returns: task identity + acceptance, before runtime fields are added. */
export type TaskDraft = Pick<
  Task,
  "id" | "title" | "kind" | "deps" | "acceptance_checks" | "acceptance_prose"
>;

/**
 * Budgets are circuit breakers, not targets. The real guards against runaway are
 * content-based (no-progress, oscillation, review convergence). These exist only to
 * stop a genuinely pathological loop, and are set far above any legitimate need.
 * `null` means UNLIMITED — the default for cost (tokens/wall), which is not a constraint.
 */
export type Budgets = {
  global_turns: number | null;
  task_attempts: number;
  token_budget: number | null;
  wall_ms: number | null;
  /** safety cap on adversarial review rounds (0 = skip review). Review normally stops on
   *  satisfaction or diminishing returns well before this. */
  review_rounds: number;
};

export type ReviewSeverity = "critical" | "high" | "medium" | "low";

export type ReviewFinding = {
  severity: ReviewSeverity;
  area: string;
  issue: string;
  fix: string;
  /** where it is (file:line / command) — keeps findings concrete, not speculative. */
  evidence?: string;
  /** why it matters to a user of the deliverable, not just a code observation. */
  impact?: string;
  check?: string;
};

export type ReviewResult = {
  satisfied: boolean;
  findings: ReviewFinding[];
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
  review_rounds_done: number;
  /** material-finding count from the previous review round (for convergence detection). */
  review_prev_material: number;
  /** consecutive review rounds that failed to reduce material findings. */
  review_stall: number;
  /** material findings the run shipped with when review stopped converging. */
  residual_findings: ReviewFinding[];
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
      items: {
        type: "object",
        additionalProperties: false,
        // Only identity + kind are required; deps/acceptance_* default in coerceGraph.
        // Real planners routinely omit acceptance_prose — rejecting on it collapsed
        // multi-task graphs to the single-task fallback (found in live testing).
        required: ["id", "title", "kind"],
        properties: {
          id: { type: "string", minLength: 1, pattern: "^[A-Za-z0-9_.-]+$" },
          title: { type: "string", minLength: 1 },
          kind: { enum: ["implement", "verify", "integrate", "remediate"] },
          deps: { type: "array", items: { type: "string" } },
          acceptance_checks: { type: "array", items: { type: "string" } },
          acceptance_prose: { type: "string" },
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
    blockers: { type: "array", items: { type: "string" } },
    next_action: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "instruction"],
      properties: {
        kind: { enum: ["continue", "replan", "switch_approach", "escalate", "none"] },
        instruction: { type: "string" },
        rationale: { type: "string" },
      },
    },
    evidence_seen: { type: "array", items: { type: "string" } },
  },
} as const;

// ── Review output: the adversarial quality reviewer's findings ────────────────
const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["satisfied", "findings"],
  properties: {
    satisfied: { type: "boolean" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "area", "issue", "fix"],
        properties: {
          severity: { enum: ["critical", "high", "medium", "low"] },
          area: { type: "string" },
          issue: { type: "string" },
          fix: { type: "string" },
          evidence: { type: "string" },
          impact: { type: "string" },
          check: { type: "string" },
        },
      },
    },
  },
} as const;

export const validateTaskGraph: ValidateFunction = ajv.compile(taskGraphSchema);
export const validateVerdict: ValidateFunction = ajv.compile(verdictSchema);
export const validateReview: ValidateFunction = ajv.compile(reviewSchema);

export function ajvErrorText(v: ValidateFunction): string {
  return (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim()).join("; ");
}

export const DEFAULT_BUDGETS: Budgets = {
  // Cost is not the constraint, the product is. Tokens and wall-clock are UNLIMITED by
  // default; turns/attempts/rounds are far-off circuit breakers, not tuning targets — the
  // run normally ends via content guards (acceptance, no-progress, oscillation, review
  // convergence) long before any of these.
  global_turns: 1000,
  task_attempts: 15,
  token_budget: null,
  wall_ms: null,
  review_rounds: 12,
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
