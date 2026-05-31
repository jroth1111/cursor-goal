import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import type { Phase } from "../trajectory/fsm.js";
import { resolveQueueHead } from "./dispatch-queue.js";
import { buildUnitTaskPrompt } from "./unit-task-prompt.js";
import { findUnitById, pendingUnits, readWorkUnits } from "./work-units.js";
import { readBlockedUnitEvidence } from "./unit-evidence.js";
import type { VerifierContext } from "../verifier/types.js";

export type NextActionKind =
  | "phase"
  | "blocked_unit"
  | "dispatch_unit"
  | "fix_checks"
  | "fix_scope"
  | "fix_proxy"
  | "fix_stale_proof"
  | "fix_other";

export type NextAction = {
  kind: NextActionKind;
  headline: string;
  detail: string;
  taskPrompt?: string;
};

export type NextActionInput = {
  ctx: VerifierContext;
  phase?: Phase;
  phaseBlocked?: boolean;
  unitsBlocked?: boolean;
  units?: WorkUnitCompiled[];
};

type RankedCandidate = { priority: number; action: NextAction };

function proxyFailures(ctx: VerifierContext): string[] {
  return ctx.failures.filter(
    (f) => f.startsWith("forbidden-proxy") || f.includes("proxy"),
  );
}

function staleProofFailures(ctx: VerifierContext): string[] {
  return ctx.failures.filter((f) => f.startsWith("stale-proof"));
}

function scopeFailures(ctx: VerifierContext): string[] {
  return ctx.failures.filter((f) => f.startsWith("out-of-scope:"));
}

function otherFailures(ctx: VerifierContext): string[] {
  const checkFails = ctx.checkResults.filter((r) => !r.ok);
  return ctx.failures.filter(
    (f) =>
      !f.startsWith("out-of-scope:") &&
      !checkFails.some((r) => r.cmd === f) &&
      !f.startsWith("forbidden-proxy") &&
      !f.includes("proxy") &&
      !f.startsWith("stale-proof"),
  );
}

async function dispatchUnitAction(
  ctx: VerifierContext,
  open: WorkUnitCompiled[],
): Promise<NextAction | null> {
  if (open.length === 0) return null;
  const head = await resolveQueueHead(ctx.root);
  const next =
    (head ? findUnitById(open, head.item.unit_id) : undefined) ??
    open.find((u) => u.status === "pending") ??
    open[0];
  const blocked = await readBlockedUnitEvidence(ctx.root, next);
  if (blocked) {
    return {
      kind: "blocked_unit",
      headline: `Unit "${next.id}" is blocked by recorded evidence`,
      detail:
        `${blocked.reason ?? "Resolve the recorded unit blocker before redispatching."} ` +
        "Do not mark the unit done or rerun the same dispatch until the blocker changes.",
    };
  }
  const received = open.filter((u) => u.status === "evidence_received");
  if (received.length > 0) {
    const u = received[0];
    return {
      kind: "dispatch_unit",
      headline: `Review unit "${u.id}" (acceptance failed or pending)`,
      detail: `Re-run acceptance or: cursor-goal units done ${u.id}`,
    };
  }
  return {
    kind: "dispatch_unit",
    headline: `Dispatch work unit "${next.id}"`,
    detail:
      "Spawn one Task/subagent with the task_prompt below, or run: cursor-goal dispatch --run",
    taskPrompt: buildUnitTaskPrompt(next),
  };
}

function phaseAction(phase: Phase): NextAction {
  return {
    kind: "phase",
    headline: `Complete phase gate (${phase})`,
    detail:
      phase === "DISCOVERY" || phase === "INTAKE"
        ? 'Run: cursor-goal discovery complete "notes"'
        : "Run: cursor-goal phase advance IMPLEMENT",
  };
}

export async function rankNextAction(input: NextActionInput): Promise<NextAction | null> {
  const { ctx } = input;
  const phase = input.phase ?? ctx.phase ?? "DISCOVERY";
  const units = input.units ?? (await readWorkUnits(ctx.root))?.units ?? [];
  const open = units.filter((u) => u.status !== "done");
  const unitsBlocked = input.unitsBlocked ?? ctx.unitsBlocked;
  const phaseBlocked = input.phaseBlocked ?? ctx.phaseBlocked;

  const candidates: RankedCandidate[] = [];

  if (unitsBlocked && open.length > 0) {
    const action = await dispatchUnitAction(ctx, open);
    if (action) candidates.push({ priority: 1, action });
  }

  const proxyFails = proxyFailures(ctx);
  if (proxyFails.length > 0) {
    candidates.push({
      priority: 2,
      action: {
        kind: "fix_proxy",
        headline: "Remove forbidden proxy language from PROGRESS.md",
        detail: "Re-run checks and paste fresh command output, not narrative proxies.",
      },
    });
  }

  const staleFails = staleProofFailures(ctx);
  if (staleFails.length > 0) {
    candidates.push({
      priority: 3,
      action: {
        kind: "fix_stale_proof",
        headline: "Re-verify after working tree changes",
        detail: staleFails[0],
      },
    });
  }

  const checkFails = ctx.checkResults.filter((r) => !r.ok);
  if (checkFails.length > 0) {
    const failed = checkFails[0];
    const output = failed.output?.trim();
    candidates.push({
      priority: 4,
      action: {
        kind: "fix_checks",
        headline: `Fix failing check: \`${failed.cmd}\``,
        detail: output
          ? "See runtime-state.json last_check_fail. Fix, then re-run checks."
          : `Re-run locally: \`${failed.cmd}\`, fix failures, update PROGRESS.md.`,
      },
    });
  }

  const scopeFails = scopeFailures(ctx);
  if (scopeFails.length > 0) {
    candidates.push({
      priority: 5,
      action: {
        kind: "fix_scope",
        headline: "Revert or justify out-of-scope edits",
        detail: scopeFails[0],
      },
    });
  }

  if (phaseBlocked && phase) {
    candidates.push({ priority: 6, action: phaseAction(phase) });
  }

  const otherFails = otherFailures(ctx);
  if (otherFails.length > 0) {
    candidates.push({
      priority: 7,
      action: {
        kind: "fix_other",
        headline: "Resolve remaining blockers",
        detail: otherFails.slice(0, 3).join("; "),
      },
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0].action;
}

export async function buildNextAction(input: NextActionInput): Promise<NextAction | null> {
  return rankNextAction(input);
}

export function secondaryBlockers(state: {
  blockers: string[];
  next_action: { headline: string; kind: string } | null;
}): string[] {
  if (!state.next_action || state.blockers.length <= 1) return [];
  const headline = state.next_action.headline.toLowerCase();
  const kind = state.next_action.kind;
  return state.blockers.filter((b) => {
    const lower = b.toLowerCase();
    if (headline.includes(lower.slice(0, Math.min(20, lower.length)))) return false;
    if (kind === "dispatch_unit" && (lower.includes("units") || lower.includes("mod-"))) return false;
    if (kind === "blocked_unit" && (lower.includes("units") || lower.includes("blocked"))) return false;
    if (kind === "fix_proxy" && lower.includes("proxy")) return false;
    if (kind === "fix_checks" && !lower.includes("proxy") && !lower.startsWith("phase:")) {
      if (lower.includes("false") || lower.includes("npm") || lower.includes("exit")) return false;
    }
    if (kind === "phase" && lower.startsWith("phase:")) return false;
    if (kind === "fix_stale_proof" && lower.includes("stale-proof")) return false;
    return true;
  });
}

export function formatNextAction(action: NextAction | null): string {
  if (!action) return "No blockers — ready for RELEASE.";
  const lines = [`## Next action (do this first)`, "", action.headline, "", action.detail];
  if (action.taskPrompt) {
    lines.push("", "Task prompt:", "```", action.taskPrompt, "```");
  }
  return lines.join("\n");
}

export async function buildNextActionFromRoot(
  ctx: VerifierContext,
  extras: Omit<NextActionInput, "ctx">,
): Promise<NextAction | null> {
  return buildNextAction({ ctx, ...extras });
}

export async function listOpenUnits(root: string): Promise<WorkUnitCompiled[]> {
  const wu = await readWorkUnits(root);
  return wu ? pendingUnits(wu.units) : [];
}
