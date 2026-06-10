import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { listDiffFiles, workingTreeFingerprint } from "../lib/git.js";
import { appendJournal } from "../lib/journal.js";
import { withDriverLock } from "../lib/lock.js";
import { atomicWriteJson, ensureDriverDirs, escalationPath } from "../lib/paths.js";
import { runTurn, usageTokens } from "../agent/runner.js";
import { runGoalAcceptance, runTaskAcceptance } from "../checks/acceptance.js";
import {
  allTasksDone,
  findTask,
  initRun,
  loadGraph,
  loadRun,
  materializeGraph,
  pickNextReadyTask,
  saveGraph,
  saveRun,
} from "../state/store.js";
import type { GoalSpec, RunState, Task, TaskGraph, Verdict } from "../state/schema.js";
import { intake } from "./intake.js";
import { decompose, type AgentCall } from "./decompose.js";
import { loadContext, recordAttempt, saveContext } from "./context-window.js";
import { buildInstruction, summarizeInstruction } from "./instruct.js";
import { getVerdict } from "./verdict.js";
import { replanTask } from "./replan.js";
import { isOscillating, pushFingerprint } from "./progress.js";
import { checkIntegrity } from "./integrity.js";
import { checkBudgets, decide, onAgentFailure, type Decision } from "./strategy.js";

export type LoopOptions = {
  root: string;
  goalInput?: string;
  model?: string | null;
  /** override budgets (e.g. tests set a tiny global_turns). */
  budgets?: Partial<RunState["budgets"]>;
  /** injectable agent call; defaults to the real cursor-agent runner. */
  call?: AgentCall;
};

const SYNTHETIC_COMPLETE: Verdict = {
  task_complete: true,
  confidence: 1,
  blockers: [],
  next_action: { kind: "none", instruction: "", rationale: "objective acceptance checks passed" },
};

async function escalate(root: string, run: RunState, reason: string): Promise<RunState> {
  run.status = "escalated";
  run.escalation_reason = reason;
  await atomicWriteJson(escalationPath(root), {
    at: new Date().toISOString(),
    goal_id: run.goal_id,
    reason,
    global_turns: run.global_turns,
    active_task: run.active_task,
  });
  await appendJournal(root, { at: new Date().toISOString(), kind: "escalation", note: reason });
  await saveRun(root, run);
  return run;
}

function appendRemediationTasks(
  graph: TaskGraph,
  failingChecks: string[],
  prose = "",
): TaskGraph {
  const id = `remediate.${graph.tasks.length + 1}`;
  const task: Task = {
    id,
    title: prose ? "Fix goal-level integrity / acceptance" : "Fix failing goal-level acceptance checks",
    kind: "remediate",
    deps: [],
    acceptance_checks: failingChecks,
    acceptance_prose: prose,
    status: "pending",
    attempts: 0,
    approach: "default",
    last_failure: prose || null,
    evidence: { proof_ptrs: [], tree: null },
  };
  return { tasks: [...graph.tasks, task] };
}

/** Returns the task to work this turn: the active in-progress task if still ready, else the next ready one. */
function selectTask(graph: TaskGraph, run: RunState): Task | null {
  if (run.active_task) {
    const active = findTask(graph, run.active_task);
    if (active && active.status !== "done") {
      const ready = active.deps.every((d) => findTask(graph, d)?.status === "done");
      if (ready) return active;
    }
  }
  return pickNextReadyTask(graph);
}

/**
 * The outer loop. Owns continuation: re-invokes cursor-agent with --resume and a
 * targeted instruction until the goal's acceptance checks pass, the run escalates,
 * or a budget is exhausted. Never trusts an agent self-claim of done over checks.
 */
export async function runGoal(opts: LoopOptions): Promise<RunState> {
  const { root } = opts;
  const call = opts.call ?? runTurn;
  await ensureDriverDirs(root);

  return withDriverLock(root, async () => {
    // ── recover or init ────────────────────────────────────────────────────────
    let run = await loadRun(root);
    let graph = await loadGraph(root);

    if (run && (run.status === "done" || run.status === "escalated")) return run;

    if (!run) {
      const spec: GoalSpec = await intake(opts.goalInput ?? "", root);
      run = initRun(spec);
      if (opts.budgets) run.budgets = { ...run.budgets, ...opts.budgets };
      run.status = "decomposed";
      await saveRun(root, run);
    } else if (opts.budgets) {
      run.budgets = { ...run.budgets, ...opts.budgets };
    }
    run.driver_pid = process.pid;

    if (!graph) {
      const dec = await decompose(run.goal_spec, root, call);
      graph = materializeGraph(dec.graph);
      await saveGraph(root, graph);
      await appendJournal(root, {
        at: new Date().toISOString(),
        kind: "lifecycle",
        note: `decomposed into ${graph.tasks.length} tasks via ${dec.source}${dec.error ? ` (${dec.error})` : ""}`,
      });
    }

    run.status = "running";
    await saveRun(root, run);

    // ── outer loop ─────────────────────────────────────────────────────────────
    while (true) {
      const budget = checkBudgets(run);
      if (budget.breached) return escalate(root, run, budget.reason ?? "budget exhausted");

      const task = selectTask(graph, run);
      if (!task) {
        if (allTasksDone(graph)) break;
        return escalate(root, run, "no ready task (dependency deadlock)");
      }

      task.status = "in_progress";
      run.active_task = task.id;
      const ctx = await loadContext(root, task.id);
      const sid = run.session_map[task.id] ?? null;
      const isFresh = !sid;
      const preTree = workingTreeFingerprint(root);
      const instruction = buildInstruction(run.goal_spec, task, ctx, ctx.next_step || null, isFresh);

      const turnStart = Date.now();
      let result;
      try {
        result = await call({ instruction, resume: sid, mode: "edit", root, model: opts.model ?? null });
      } catch (e) {
        result = {
          sessionId: sid,
          finalText: e instanceof Error ? e.message : String(e),
          usage: null,
          terminal: "error" as const,
          exitCode: null,
          timedOut: false,
        };
      }
      const elapsed = Date.now() - turnStart;

      if (result.sessionId) run.session_map[task.id] = result.sessionId;
      run.global_turns += 1;
      task.attempts += 1;
      run.consumed.tokens += usageTokens(result.usage);
      run.consumed.wall_ms += elapsed;

      const postTree = workingTreeFingerprint(root);
      const progressed = postTree !== preTree;
      task.evidence.tree = postTree;

      await appendJournal(root, {
        at: new Date().toISOString(),
        kind: "turn",
        task_id: task.id,
        global_turn: run.global_turns,
        terminal: result.terminal,
        progressed,
        tokens: usageTokens(result.usage),
        note: summarizeInstruction(instruction),
      });

      let decision: Decision;
      let checkFails: string[] = [];

      if (result.terminal !== "success") {
        ctx.last_failure = result.finalText.slice(-1500);
        task.last_failure = ctx.last_failure;
        decision = onAgentFailure(run, task);
      } else {
        const acceptance = await runTaskAcceptance(root, task);
        run.no_progress_streak = progressed ? 0 : run.no_progress_streak + 1;
        const oscillating = isOscillating(run, postTree);
        pushFingerprint(run, postTree);
        checkFails = acceptance.results.filter((r) => !r.ok).map((r) => r.cmd);
        const diffFiles = listDiffFiles(root);

        // Reward-hacking / scope-creep guard: blocks completion even if checks pass.
        const integrityIssues = checkIntegrity(root, diffFiles, run.goal_spec.scope);

        let verdict: Verdict;
        if (acceptance.objective && acceptance.allPass) {
          verdict = SYNTHETIC_COMPLETE; // skip the LLM when checks decide it (cost guard)
        } else {
          const vr = await getVerdict(
            task,
            ctx,
            acceptance.results,
            result.finalText,
            diffFiles,
            root,
            progressed,
            call,
          );
          verdict = vr.verdict;
        }

        const failNotes: string[] = [];
        if (acceptance.results.some((r) => !r.ok)) {
          failNotes.push(
            acceptance.results
              .filter((r) => !r.ok)
              .map((r) => `$ ${r.cmd}\n${(r.output ?? "").slice(-600)}`)
              .join("\n---\n"),
          );
        }
        if (integrityIssues.length) {
          failNotes.push(`Integrity violation: ${integrityIssues.join("; ")}`);
          checkFails.push(...integrityIssues);
          await appendJournal(root, {
            at: new Date().toISOString(),
            kind: "lifecycle",
            task_id: task.id,
            note: `integrity blocked completion: ${integrityIssues.join("; ")}`,
          });
        }
        if (failNotes.length) {
          ctx.last_failure = failNotes.join("\n").slice(-1500);
          task.last_failure = ctx.last_failure;
        }

        decision = decide(run, task, acceptance.results, verdict, progressed, oscillating, {
          ok: integrityIssues.length === 0,
          issues: integrityIssues,
        });
      }

      recordAttempt(ctx, {
        turn: run.global_turns,
        instruction_summary: ctx.next_step || summarizeInstruction(instruction),
        terminal: result.terminal,
        check_fails: checkFails,
        diff_stat: progressed ? "changed" : "no-change",
      });

      await appendJournal(root, {
        at: new Date().toISOString(),
        kind: "decision",
        task_id: task.id,
        decision: decision.kind,
        checks_pass: decision.kind === "task_done",
        note: decision.reason,
      });

      // ── apply decision ────────────────────────────────────────────────────────
      switch (decision.kind) {
        case "task_done":
          task.status = "done";
          ctx.next_step = "";
          run.active_task = null;
          break;
        case "continue_same_session":
          ctx.next_step = decision.instruction ?? "";
          break;
        case "switch_approach":
          delete run.session_map[task.id];
          task.approach = (decision.instruction ?? "alternative approach").slice(0, 200);
          if (decision.instruction && !ctx.tried_approaches.includes(decision.instruction)) {
            ctx.tried_approaches.push(decision.instruction);
          }
          ctx.next_step = "";
          break;
        case "replan": {
          const newGraph = await replanTask(graph, task, decision.reason, run.goal_spec, root, call);
          if (newGraph) {
            graph = newGraph;
            run.active_task = null;
            await appendJournal(root, {
              at: new Date().toISOString(),
              kind: "replan",
              task_id: task.id,
              note: `replanned ${task.id} into subtasks`,
            });
          } else {
            await saveContext(root, ctx);
            await saveGraph(root, graph);
            await saveRun(root, run);
            return escalate(root, run, `replan failed for ${task.id}: ${decision.reason}`);
          }
          break;
        }
        case "escalate":
          await saveContext(root, ctx);
          await saveGraph(root, graph);
          return escalate(root, run, decision.reason);
      }

      await saveContext(root, ctx);
      await saveGraph(root, graph);
      await saveRun(root, run);

      // ── goal-level stop gate ──────────────────────────────────────────────────
      if (allTasksDone(graph)) {
        const goalAcceptance = await runGoalAcceptance(root, run.goal_spec);
        const goalIntegrity = checkIntegrity(root, listDiffFiles(root), run.goal_spec.scope);
        const checksOk = !goalAcceptance.objective || goalAcceptance.allPass;
        if (checksOk && goalIntegrity.length === 0) {
          run.status = "done";
          run.active_task = null;
          await appendJournal(root, {
            at: new Date().toISOString(),
            kind: "lifecycle",
            note: goalAcceptance.objective ? "goal acceptance checks pass" : "all tasks done (no goal-level checks)",
          });
          await saveRun(root, run);
          if (existsSync(escalationPath(root))) await rm(escalationPath(root)).catch(() => undefined);
          return run;
        }
        const failing = goalAcceptance.results.filter((r) => !r.ok).map((r) => r.cmd);
        const prose = goalIntegrity.length
          ? `Undo the integrity violation while keeping checks green: ${goalIntegrity.join("; ")}`
          : "";
        graph = appendRemediationTasks(graph, failing, prose);
        await saveGraph(root, graph);
        await appendJournal(root, {
          at: new Date().toISOString(),
          kind: "lifecycle",
          note: goalIntegrity.length
            ? `goal-level integrity violation (${goalIntegrity.join("; ")}); added remediation task`
            : `goal checks failing (${failing.join(", ")}); added remediation task`,
        });
      }
    }

    run.status = "done";
    await saveRun(root, run);
    return run;
  });
}
