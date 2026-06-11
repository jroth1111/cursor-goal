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
  /** Planner-proposed path fence for THIS task (may only narrow the goal scope;
   *  empty = inherit the goal scope). Advisory-quality: violations feed back via
   *  the integrity ladder, they never instantly escalate. */
  scope: string[];
  status: TaskStatus;
  attempts: number;
  approach: string;
  last_failure: string | null;
  last_failure_artifact: string | null;
  evidence: { proof_ptrs: string[]; tree: string | null };
};

export type TaskGraph = { tasks: Task[] };

/** What the planner returns: task identity + acceptance, before runtime fields are added.
 *  scope is optional here — planners routinely omit it; materializeGraph defaults it. */
export type TaskDraft = Pick<
  Task,
  "id" | "title" | "kind" | "deps" | "acceptance_checks" | "acceptance_prose"
> &
  Partial<Pick<Task, "scope">>;

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

/**
 * Per-goal run configuration from GOAL.md's `## Driver` section. The key set is
 * deliberately small and enumerated — this is goal metadata, not a config system.
 * Precedence everywhere: CLI flags > these defaults > DEFAULT_BUDGETS.
 */
export type DriverDefaults = {
  model?: string;
  /** routes the brain calls (decompose/verdict/review/replan) to a cheaper model;
   *  edit turns keep `model`. Opt-in economy lever — verdict quality is a
   *  correctness input, so this is never a default. */
  brain_model?: string;
  max_turns?: number;
  review_rounds?: number;
  task_attempts?: number;
  /** consumed on run completion/escalation by the notify hook. */
  notify_cmd?: string;
  /** cap on bulky evidence (tool-outputs, turn-failures, transcripts); default 500. */
  evidence_cap_mb?: number;
};

export type GoalSpec = {
  goal_text: string;
  source: "GOAL.md" | "prompt";
  acceptance_checks: string[];
  non_goals: string[];
  scope: string[];
  driver_defaults?: DriverDefaults;
};

/** Budget overrides applied to an EXISTING run (resume's breach probe and the
 *  loop's resume path) — one definition so the probe's verdict can never
 *  diverge from the budgets the run actually gets. */
export function applyBudgetOverrides(budgets: Budgets, overrides?: Partial<Budgets>): Budgets {
  return { ...budgets, ...overrides };
}

/** flags > GOAL.md `## Driver` defaults > DEFAULT_BUDGETS (plan decision: one merge home). */
export function mergeBudgets(flags: Partial<Budgets>, defaults?: DriverDefaults): Budgets {
  const fromFile: Partial<Budgets> = {};
  if (defaults?.max_turns != null) fromFile.global_turns = defaults.max_turns;
  if (defaults?.review_rounds != null) fromFile.review_rounds = defaults.review_rounds;
  if (defaults?.task_attempts != null) fromFile.task_attempts = defaults.task_attempts;
  return { ...DEFAULT_BUDGETS, ...fromFile, ...flags };
}

/**
 * The fixed point recorded BEFORE the first turn — everything that answers "what
 * did the run change" (diff, report, worktree adoption) measures against this.
 * It cannot be reconstructed once turns start mutating the tree.
 */
export type Baseline = {
  /** HEAD at intake; null in a repo with no commits yet. */
  head_sha: string | null;
  /** repo-relative path to the saved pre-run dirty patch; null when the tree was clean. */
  dirty_patch_artifact: string | null;
  fingerprint: string;
};

/** Where a run's tokens went. Cost is unlimited by design (budgets are circuit
 *  breakers), which makes VISIBILITY the only cost control — and the measurement
 *  that justifies (or kills) routing brain calls to a cheaper model. */
export type CallCategory = "edit" | "decompose" | "verdict" | "review" | "replan";

export type RunState = {
  version: 1;
  goal_id: string;
  goal_spec: GoalSpec;
  /** null only for run.json written before baseline capture existed. */
  baseline: Baseline | null;
  status: RunStatus;
  global_turns: number;
  budgets: Budgets;
  consumed: {
    tokens: number;
    wall_ms: number;
    /** invariant: values sum to `tokens` (both mutate only through the loop's
     *  single accumulation helper). */
    tokens_by_category: Record<CallCategory, number>;
  };
  no_progress_streak: number;
  fingerprint_ring: string[];
  session_map: Record<string, string>;
  active_task: string | null;
  review_rounds_done: number;
  /** goal-level checks the PLANNER proposed (weaker authority than human checks):
   *  an unrunnable one is dropped at the gate instead of remediated forever. */
  proposed_goal_checks: string[];
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
    // proposed goal-level acceptance for freeform prompts (never overrides human
    // checks). Items deliberately unconstrained: decompose filters to non-empty
    // strings rather than letting one stray number void an otherwise-good plan.
    goal_checks: { type: "array" },
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
          scope: { type: "array", items: { type: "string" } },
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

/** One normalization for scope entries — validation (here) and turn-time
 *  enforcement (integrity.ts) must agree or the fence drifts. */
export function normalizeScopeEntry(s: string): string {
  return s.replace(/^\.\//, "").replace(/\/+$/, "").trim();
}

/** True when `entry` is equal to or nested under some goal-scope entry. */
export function scopeEntryWithin(entry: string, goalScope: string[]): boolean {
  const e = normalizeScopeEntry(entry);
  return goalScope.some((g) => {
    const n = normalizeScopeEntry(g);
    return n === e || e.startsWith(`${n}/`);
  });
}

/**
 * Acyclic + every dep resolvable + each non-verify task has acceptance. When the
 * goal scope is non-empty, a task's scope may only narrow it — a task-scope entry
 * outside every goal-scope entry is a planner error (the integrity fence would
 * otherwise silently widen).
 */
export function validateGraphSemantics(graph: TaskGraph, goalScope: string[] = []): string | null {
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
    if (goalScope.length) {
      for (const s of t.scope ?? []) {
        if (!scopeEntryWithin(s, goalScope)) {
          return `task ${t.id} scope entry '${s}' falls outside the goal scope`;
        }
      }
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
