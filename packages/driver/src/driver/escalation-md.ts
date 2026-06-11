import { formatFailureForPrompt } from "../lib/progressive-reveal.js";
import type { RunState, Task, TaskGraph } from "../state/schema.js";
import type { ContextWindow } from "./context-window.js";

/**
 * The document a human actually reads at the moment the run gives up. The
 * driver's evidence collection pays off for the operator here: what was tried,
 * where the proof lives, and the literal next commands. ESCALATION.json stays
 * the machine-shaped record next to it.
 */
export function renderEscalationMd(
  run: RunState,
  graph: TaskGraph | null,
  contexts: Map<string, ContextWindow>,
): string {
  const lines: string[] = [];
  const stuck: Task[] = (graph?.tasks ?? []).filter((t) => t.status !== "done");
  const done: Task[] = (graph?.tasks ?? []).filter((t) => t.status === "done");
  const primary = run.active_task ?? stuck[0]?.id ?? "<task-id>";

  lines.push(`# Escalation — ${run.goal_spec.goal_text.slice(0, 100)}`);
  lines.push("");
  lines.push("## Why");
  lines.push("");
  lines.push(run.escalation_reason ?? "(no reason recorded)");
  lines.push("");
  lines.push(`Escalated at ${run.updated_at}, after turn ${run.global_turns}.`);
  lines.push("");

  lines.push("## Where it stopped");
  lines.push("");
  if (!stuck.length) {
    lines.push("All tasks were done — the goal-level gate or review escalated.");
  }
  for (const t of stuck) {
    const ctx = contexts.get(t.id);
    lines.push(`### ${t.id} — ${t.title} [${t.status}]`);
    lines.push("");
    lines.push(`- attempts: ${t.attempts} of ${run.budgets.task_attempts}`);
    if (t.approach && t.approach !== "default") lines.push(`- current approach: ${t.approach}`);
    if (ctx?.tried_approaches.length) {
      lines.push(`- tried approaches:`);
      for (const a of ctx.tried_approaches) lines.push(`  - ${a}`);
    }
    if (t.acceptance_checks.length) {
      lines.push("- acceptance (commands that must exit 0):");
      for (const c of t.acceptance_checks) lines.push(`  - \`${c}\``);
    }
    if (t.acceptance_prose.trim()) lines.push(`- acceptance (prose): ${t.acceptance_prose.trim()}`);
    const failure = ctx?.last_failure || t.last_failure;
    if (failure) {
      lines.push("- last failure:");
      lines.push("");
      lines.push("```");
      lines.push(formatFailureForPrompt(failure, ctx?.last_failure_artifact || t.last_failure_artifact || undefined));
      lines.push("```");
    }
    if (ctx?.operator_guidance.length) {
      lines.push(`- operator guidance already given: ${ctx.operator_guidance.length} note(s) (latest: ${ctx.operator_guidance[ctx.operator_guidance.length - 1].text})`);
    }
    if (t.evidence.proof_ptrs.length) {
      lines.push(`- evidence: ${t.evidence.proof_ptrs.slice(-5).join(", ")}`);
    }
    lines.push("");
  }
  if (done.length) {
    lines.push(`(${done.length} task(s) already done: ${done.map((t) => t.id).join(", ")})`);
    lines.push("");
  }

  lines.push("## What it cost");
  lines.push("");
  const cap = run.budgets.global_turns == null ? "∞" : String(run.budgets.global_turns);
  lines.push(
    `turns ${run.global_turns}/${cap} · tokens ${run.consumed.tokens} · wall ${Math.round(run.consumed.wall_ms / 1000)}s · review rounds ${run.review_rounds_done}`,
  );
  lines.push("");

  lines.push("## What to do next");
  lines.push("");
  lines.push(`- inspect the trail: \`agent-driver logs --task ${primary}\` (or \`agent-driver logs --follow\`)`);
  lines.push(`- answer the blocker: \`agent-driver steer ${primary} "your one-line guidance"\``);
  lines.push("- continue the run: `agent-driver resume` (budget breaches need the raise, e.g. `--max-turns N`)");
  lines.push("- start over: `agent-driver reset` (archives this run under runs/)");
  lines.push("");
  lines.push("ESCALATION.json next to this file carries the machine-readable reason.");
  lines.push("");
  return lines.join("\n");
}
