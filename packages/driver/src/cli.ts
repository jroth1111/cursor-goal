#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseFlags } from "./lib/cli-flags.js";
import { projectRoot } from "./lib/paths.js";
import { agentBin } from "./agent/runner.js";
import { runGoal } from "./driver/loop.js";
import { formatTokensByCategory, stderrProgress } from "./driver/progress-io.js";
import { computeNext } from "./bridge/hook-next.js";
import { runLogs } from "./driver/logs.js";
import { formatDiff, runDiff } from "./driver/diff.js";
import { formatProbe, probeContract } from "./driver/probe.js";
import { buildRunReport, writeRunReport } from "./driver/report.js";
import { createRunWorktree, worktreeSummary } from "./driver/worktree.js";
import { formatFindings, lintGoalMd } from "./driver/goal-lint.js";
import { archivedRunCount, resetRun } from "./driver/reset.js";
import { resumeRun } from "./driver/resume.js";
import { steerTask } from "./driver/steer.js";
import { intake } from "./driver/intake.js";
import type { RunState } from "./state/schema.js";
import { decompose } from "./driver/decompose.js";
import { runGoalAcceptance } from "./checks/acceptance.js";
import { loadGraph, loadRun } from "./state/store.js";


/** Budget overrides shared by `run` and `resume` (fast = skip the excellence gate). */
function budgetFlags(flags: Record<string, string | boolean>): Partial<RunState["budgets"]> | undefined {
  const budgets: Partial<RunState["budgets"]> = {};
  if (typeof flags["max-turns"] === "string") budgets.global_turns = Number(flags["max-turns"]);
  if (typeof flags["review-rounds"] === "string") budgets.review_rounds = Number(flags["review-rounds"]);
  if (flags.fast) budgets.review_rounds = 0;
  return Object.keys(budgets).length ? budgets : undefined;
}

/** The options block `run` and `resume` share — one home so a new knob cannot
 *  land in one verb and silently miss the other. */
function driveOptions(flags: Record<string, string | boolean>, stop: AbortSignal) {
  return {
    model: typeof flags.model === "string" ? flags.model : null,
    budgets: budgetFlags(flags),
    // live progress on stderr; stdout stays the machine-readable summary
    progress: flags.quiet ? undefined : stderrProgress,
    stop,
    notify: typeof flags.notify === "string" ? flags.notify : undefined,
    brainModel: typeof flags["brain-model"] === "string" ? flags["brain-model"] : null,
  };
}

function printRunSummary(run: RunState): number {
  process.stdout.write(
    `${JSON.stringify(
      {
        status: run.status,
        turns: run.global_turns,
        review_rounds: run.review_rounds_done,
        escalation: run.escalation_reason,
        residual_findings: run.residual_findings.map((f) => `${f.severity}/${f.area}: ${f.issue}`),
      },
      null,
      2,
    )}\n`,
  );
  if (run.status === "paused") return 130;
  return run.status === "done" ? 0 : run.status === "escalated" ? 2 : 1;
}

/**
 * SIGINT/SIGTERM during a drive: first signal requests a graceful stop (the loop
 * kills the in-flight turn, persists, parks as paused); a second SIGINT is the
 * escape hatch (the stale-lock reaper cleans up after a hard exit).
 */
async function withStopSignals<T>(fn: (stop: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let interrupts = 0;
  const onSignal = () => {
    interrupts += 1;
    if (interrupts === 1) {
      process.stderr.write("\nstopping after the current turn is cleaned up — Ctrl-C again to force-quit\n");
      ctl.abort();
    } else {
      process.exit(130);
    }
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    return await fn(ctl.signal);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

async function cmdRun(flags: Record<string, string | boolean>, rest: string[]): Promise<number> {
  let root = projectRoot();
  const goalInput = rest.join(" ");

  // --worktree: drive the whole run in a disposable git worktree; the user's
  // checkout is untouched and adoption stays a human decision.
  let worktree: { root: string; branch: string } | null = null;
  if (flags.worktree && !flags["dry-run"]) {
    const mainRoot = root;
    const spec = await intake(goalInput, mainRoot);
    const created = createRunWorktree(mainRoot, spec.goal_text);
    if (!created.ok) {
      process.stdout.write(`${created.message}\n`);
      return 1;
    }
    worktree = { root: created.root, branch: created.branch };
    process.stderr.write(`isolating run in worktree ${created.root} (branch ${created.branch})\n`);
    root = created.root;
  }

  if (flags["dry-run"]) {
    const goalMd = `${root}/GOAL.md`;
    if (existsSync(goalMd)) {
      const findings = lintGoalMd(await readFile(goalMd, "utf8"), root);
      if (findings.length) process.stderr.write(formatFindings(findings));
    }
    const spec = await intake(goalInput, root);
    const dec = await decompose(spec, root);
    process.stdout.write(`${JSON.stringify({ spec, decompose: dec }, null, 2)}\n`);
    return 0;
  }

  // a terminal run never restarts by accident — point at the explicit verbs
  const existing = await loadRun(root);
  if (existing && (existing.status === "done" || existing.status === "escalated")) {
    process.stderr.write(
      `run already ${existing.status} — 'agent-driver resume' continues an escalated run; 'agent-driver reset' starts a new goal\n`,
    );
    return printRunSummary(existing);
  }

  const run = await withStopSignals((stop) => runGoal({ root, goalInput, ...driveOptions(flags, stop) }));
  const code = printRunSummary(run);
  if (worktree) {
    process.stderr.write(`${worktreeSummary(projectRoot(), worktree.root, worktree.branch)}\n`);
  }
  return code;
}

async function cmdResume(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  const outcome = await withStopSignals((stop) => resumeRun(root, driveOptions(flags, stop)));
  if (!outcome.ok) {
    process.stdout.write(`${outcome.message}\n`);
    return 1;
  }
  return printRunSummary(outcome.run);
}

async function cmdNext(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  const loopCount = typeof flags["loop-count"] === "string" ? Number(flags["loop-count"]) : 0;
  const result = await computeNext(root, Number.isFinite(loopCount) ? loopCount : 0);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

async function cmdReport(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  if (flags.stdout) {
    const built = await buildRunReport(root);
    process.stdout.write(built.ok ? `${built.content}\n` : `${built.message}\n`);
    return built.ok ? 0 : 1;
  }
  const written = await writeRunReport(root);
  process.stdout.write(written.ok ? `wrote ${written.message}\n` : `${written.message}\n`);
  return written.ok ? 0 : 1;
}

async function cmdDiff(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  const outcome = await runDiff(root, { full: flags.full === true });
  process.stdout.write(formatDiff(outcome));
  return outcome.ok ? 0 : 1;
}

async function cmdLint(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  const goalMd = `${root}/GOAL.md`;
  if (!existsSync(goalMd)) {
    process.stdout.write("No GOAL.md in this repo — nothing to lint (freeform prompts need none).\n");
    return 1;
  }
  const findings = lintGoalMd(await readFile(goalMd, "utf8"), root);
  process.stdout.write(formatFindings(findings));
  const errors = findings.some((f) => f.severity === "error");
  return flags.strict && errors ? 1 : 0;
}

async function cmdSteer(rest: string[]): Promise<number> {
  const root = projectRoot();
  const [taskId, ...guidance] = rest;
  if (!taskId) {
    process.stdout.write('Usage: agent-driver steer <task-id> "guidance"\n');
    return 1;
  }
  const result = await steerTask(root, taskId, guidance.join(" "));
  process.stdout.write(`${result.message}\n`);
  return result.ok ? 0 : 1;
}

async function cmdReset(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  const result = await resetRun(root, { keepEvidence: flags["keep-evidence"] === true });
  process.stdout.write(`${result.message}\n`);
  return result.ok ? 0 : 1;
}

async function cmdStatus(): Promise<number> {
  const root = projectRoot();
  const run = await loadRun(root);
  const graph = await loadGraph(root);
  const archived = await archivedRunCount(root);
  const archivedLine = archived ? `archived runs: ${archived}\n` : "";
  if (!run) {
    process.stdout.write(`No driver run in this repo.\n${archivedLine}`);
    return 0;
  }
  const taskLines = (graph?.tasks ?? [])
    .map((t) => `  ${t.status === "done" ? "✓" : "○"} ${t.id} [${t.status}] ${t.title} (attempts ${t.attempts})`)
    .join("\n");
  const cap = run.budgets.global_turns == null ? "∞" : String(run.budgets.global_turns);
  const byCat = formatTokensByCategory(run.consumed.tokens_by_category);
  const tokensLine = byCat ? `${run.consumed.tokens} (${byCat})` : String(run.consumed.tokens);
  const residual = run.residual_findings.length
    ? `residual findings (shipped, unresolved):\n` +
      run.residual_findings.map((f) => `  ! ${f.severity}/${f.area}: ${f.issue}`).join("\n") +
      "\n"
    : "";
  process.stdout.write(
    `goal: ${run.goal_spec.goal_text}\nstatus: ${run.status}  turns: ${run.global_turns}/${cap}  review rounds: ${run.review_rounds_done}  tokens: ${tokensLine}\n` +
      (run.escalation_reason ? `escalation: ${run.escalation_reason}\n` : "") +
      residual +
      archivedLine +
      `tasks:\n${taskLines}\n`,
  );
  return 0;
}

async function cmdLogs(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  const tail = typeof flags.tail === "string" ? Number(flags.tail) : undefined;
  await runLogs(
    root,
    {
      task: typeof flags.task === "string" ? flags.task : undefined,
      kind: typeof flags.kind === "string" ? flags.kind : undefined,
      tail: tail != null && Number.isFinite(tail) ? tail : undefined,
      follow: flags.follow === true,
      pollMs: typeof flags["poll-ms"] === "string" ? Number(flags["poll-ms"]) : undefined,
    },
    (line) => process.stdout.write(line),
  );
  return 0;
}

async function cmdVerify(): Promise<number> {
  const root = projectRoot();
  const run = await loadRun(root);
  if (!run) {
    process.stdout.write("No driver run; nothing to verify.\n");
    return 0;
  }
  const outcome = await runGoalAcceptance(root, run.goal_spec);
  if (!outcome.objective) {
    process.stdout.write("No goal-level acceptance checks defined.\n");
    return 0;
  }
  for (const r of outcome.results) {
    process.stdout.write(`  [${r.ok ? "PASS" : "FAIL"}] ${r.cmd}\n`);
  }
  return outcome.allPass ? 0 : 1;
}

async function cmdDoctor(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  const bin = agentBin();
  let version = "unresolved";
  let agentOk = false;
  try {
    version = execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
    agentOk = true;
  } catch {
    /* unresolved */
  }
  const hooksJson = `${root}/.cursor/hooks.json`;
  const hooksInstalled = existsSync(hooksJson);
  process.stdout.write(
    `agent-driver doctor\n` +
      `  cursor-agent: ${agentOk ? `ok (${version})` : `NOT FOUND ('${bin}')`}\n` +
      `  project root: ${root}\n` +
      `  hooks.json: ${hooksInstalled ? "present" : "absent (safety net not installed)"}\n` +
      `  note: the driver owns its own checks and loop; hooks are a safety net, not a dependency.\n`,
  );
  if (!flags.probe) return agentOk ? 0 : 1;
  if (!agentOk) {
    process.stdout.write("  probe skipped: cursor-agent not resolvable\n");
    return 1;
  }
  process.stdout.write("  running live contract probe (two tiny real turns; costs a few tokens)…\n");
  const probe = await probeContract(root);
  process.stdout.write(formatProbe(probe));
  return probe.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const { flags, rest } = parseFlags(argv.slice(1));
  let code = 0;
  switch (cmd) {
    case "run":
      code = await cmdRun(flags, rest);
      break;
    case "resume":
      code = await cmdResume(flags);
      break;
    case "next":
      code = await cmdNext(flags);
      break;
    case "status":
      code = await cmdStatus();
      break;
    case "logs":
      code = await cmdLogs(flags);
      break;
    case "reset":
      code = await cmdReset(flags);
      break;
    case "steer":
      code = await cmdSteer(rest);
      break;
    case "lint":
      code = await cmdLint(flags);
      break;
    case "diff":
      code = await cmdDiff(flags);
      break;
    case "report":
      code = await cmdReport(flags);
      break;
    case "verify":
      code = await cmdVerify();
      break;
    case "doctor":
      code = await cmdDoctor(flags);
      break;
    default:
      process.stdout.write(
        "Usage: agent-driver <run|next|status|verify|doctor> [goal...]\n" +
          "  run [goal]         decompose and drive cursor-agent to the goal\n" +
          "                     flags: --max-turns N --model M --dry-run --review-rounds N --fast --quiet\n" +
          '                            --notify "cmd" (run on done/escalated; JSON summary on stdin)\n' +
          "                            --worktree (drive the run in a disposable git worktree; checkout untouched)\n" +
          "                            --brain-model M (route decompose/verdict/review/replan to a cheaper model)\n" +
          "  resume             continue an escalated or paused run (accepts run's budget flags)\n" +
          "  next               print {followup_message?} for an interactive stop hook (flag: --loop-count N)\n" +
          "  status             show run + task graph\n" +
          "  logs               pretty-print the run journal\n" +
          "                     flags: --task ID --kind turn|decision|lifecycle|replan|escalation --tail N --follow\n" +
          "  reset              archive the current run under runs/ and start fresh (flag: --keep-evidence)\n" +
          '  steer              steer <task-id> "guidance" — inject operator guidance into a task\n' +
          "  lint               validate GOAL.md (sections, prose-as-shell checks, dead scope paths; --strict exits 1 on errors)\n" +
          "  diff               cumulative run changes vs the intake baseline (--full for the unified diff)\n" +
          "  report             render RUN_REPORT.md — the auditable run summary (--stdout to print)\n" +
          "  verify             run goal-level acceptance checks\n" +
          "  doctor             check cursor-agent availability and hook install\n" +
          "                     --probe runs two tiny REAL turns to validate the stream contract (spends tokens)\n",
      );
      code = cmd ? 1 : 0;
  }
  process.exit(code);
}

main().catch((e) => {
  process.stderr.write(`agent-driver error: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
