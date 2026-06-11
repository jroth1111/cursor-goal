import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { readJournalTail, type JournalEntry } from "../lib/journal.js";
import { loadGraph, loadRun } from "../state/store.js";
import type { RunState, TaskGraph } from "../state/schema.js";
import { loadContext, type ContextWindow } from "./context-window.js";
import { runDiff, type DiffOutcome } from "./diff.js";
import { formatTokensByCategory } from "./progress-io.js";

/**
 * The run's deliverable-about-the-deliverable: the artifact an operator pastes
 * into a PR description or hands a teammate. Pure presentation over what the run
 * already collected — render what exists, say what is absent, invent nothing.
 */
export function renderRunReport(args: {
  root: string;
  run: RunState;
  graph: TaskGraph | null;
  journal: JournalEntry[];
  contexts: Map<string, ContextWindow>;
  diff: DiffOutcome | null;
}): string {
  const { root, run, graph, journal, contexts, diff } = args;
  const L: string[] = [];

  L.push(`# Run report — ${run.goal_spec.goal_text.slice(0, 120)}`);
  L.push("");
  L.push("## Summary");
  L.push("");
  const cap = run.budgets.global_turns == null ? "∞" : String(run.budgets.global_turns);
  L.push(`- status: **${run.status}**${run.escalation_reason ? ` — ${run.escalation_reason}` : ""}`);
  L.push(`- goal source: ${run.goal_spec.source}`);
  const byCat = formatTokensByCategory(run.consumed.tokens_by_category, " · ");
  L.push(
    `- turns: ${run.global_turns}/${cap} · tokens: ${run.consumed.tokens}${byCat ? ` (${byCat})` : ""} · wall: ${Math.round(run.consumed.wall_ms / 1000)}s`,
  );
  if (run.goal_spec.acceptance_checks.length) {
    L.push(`- goal acceptance: ${run.goal_spec.acceptance_checks.map((c) => `\`${c}\``).join("; ")}`);
    if (run.proposed_goal_checks.length) {
      L.push(`  (planner-proposed: ${run.proposed_goal_checks.map((c) => `\`${c}\``).join("; ")})`);
    }
  } else {
    L.push("- goal acceptance: none (no goal-level checks)");
  }
  L.push("");

  L.push("## Tasks");
  L.push("");
  if (!graph) {
    L.push("(no task graph yet — the run had not decomposed)");
  }
  for (const t of graph?.tasks ?? []) {
    L.push(`### ${t.status === "done" ? "✓" : "○"} ${t.id} — ${t.title}`);
    L.push("");
    L.push(`- kind: ${t.kind} · status: ${t.status} · attempts: ${t.attempts}`);
    if (t.approach && t.approach !== "default") L.push(`- final approach: ${t.approach}`);
    const decisions = journal.filter((e) => e.kind === "decision" && e.task_id === t.id);
    if (decisions.length) {
      const trail = decisions.map((d) => d.decision).join(" → ");
      L.push(`- decision trail: ${trail}`);
    }
    const ctx = contexts.get(t.id);
    const failure = ctx?.last_failure || t.last_failure;
    if (failure && t.status !== "done") {
      L.push(`- last failure: ${failure.split("\n")[0].slice(0, 160)}`);
      const artifact = ctx?.last_failure_artifact || t.last_failure_artifact;
      if (artifact) L.push(`  full: ${artifact}`);
    }
    if (ctx?.operator_guidance.length) {
      L.push(`- operator guidance given: ${ctx.operator_guidance.length} note(s)`);
    }
    if (t.evidence.proof_ptrs.length) {
      const ptrs = t.evidence.proof_ptrs.slice(-5).map((p2) => {
        const exists = existsSync(path.resolve(root, p2));
        return exists ? p2 : `${p2} (rotated)`;
      });
      L.push(`- evidence: ${ptrs.join(", ")}`);
    }
    L.push("");
  }

  L.push("## Quality");
  L.push("");
  if (run.budgets.review_rounds === 0) {
    L.push("adversarial review skipped (--fast / review_rounds 0)");
  } else if (run.review_rounds_done === 0) {
    L.push("no review rounds ran (the run did not reach the excellence gate)");
  } else if (run.residual_findings.length) {
    L.push(`${run.review_rounds_done} review round(s); shipped with ${run.residual_findings.length} residual finding(s):`);
    L.push("");
    L.push("| severity | area | issue |");
    L.push("|---|---|---|");
    for (const f of run.residual_findings) {
      L.push(`| ${f.severity} | ${f.area} | ${f.issue.replace(/\|/g, "\\|")} |`);
    }
  } else {
    L.push(`${run.review_rounds_done} review round(s); reviewer satisfied — no residual findings`);
  }
  L.push("");

  L.push("## Changes");
  L.push("");
  if (!diff) {
    L.push("(no baseline recorded — this run predates baseline capture; changes vs the starting point are not reconstructible)");
  } else if (!diff.ok) {
    L.push(`(${diff.message})`);
  } else {
    if (diff.diff.trim()) {
      L.push("```");
      L.push(diff.diff.trimEnd());
      L.push("```");
    }
    if (diff.newFiles.length) {
      L.push(`new files: ${diff.newFiles.join(", ")}`);
    }
    if (!diff.diff.trim() && !diff.newFiles.length) L.push("no changes vs baseline");
    if (diff.dirtyNote) L.push(`\n${diff.dirtyNote}`);
  }
  L.push("");
  return L.join("\n");
}

export type ReportOutcome = { ok: boolean; message: string; content?: string };

export async function buildRunReport(root: string): Promise<ReportOutcome> {
  const run = await loadRun(root);
  if (!run) return { ok: false, message: "No driver run in this repo; nothing to report." };
  const graph = await loadGraph(root);
  const journal = await readJournalTail(root, 100_000);
  const tasks = graph?.tasks ?? [];
  const loaded = await Promise.all(tasks.map((t) => loadContext(root, t.id)));
  const contexts = new Map<string, ContextWindow>(tasks.map((t, i) => [t.id, loaded[i]]));
  const diff = run.baseline ? await runDiff(root) : null;
  const content = renderRunReport({ root, run, graph, journal, contexts, diff });
  return { ok: true, message: "ok", content };
}

export async function writeRunReport(root: string): Promise<ReportOutcome> {
  const built = await buildRunReport(root);
  if (!built.ok || !built.content) return built;
  const file = path.join(root, "RUN_REPORT.md");
  await writeFile(file, built.content, "utf8");
  return { ok: true, message: file, content: built.content };
}
