import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { listDiffFiles, workingTreeFingerprint } from "../lib/git.js";
import { appendJournal } from "../lib/journal.js";
import { formatCheckFailuresFull, writeTurnFailureArtifact } from "../lib/progressive-reveal.js";
import { mergeProofPtrs, readToolRunsSince } from "../lib/tool-runs.js";
import { withDriverLock } from "../lib/lock.js";
import { atomicWriteJson, ensureDriverDirs, escalationPath, transcriptsDir } from "../lib/paths.js";
import { runTurn, usageTokens } from "../agent/runner.js";
import { runGoalAcceptance, runTaskAcceptance } from "../checks/acceptance.js";
import {
  allTasksDone,
  findTask,
  initRun,
  loadGraph,
  materializeGraph,
  pickNextReadyTask,
  saveGraph,
  saveRun,
} from "../state/store.js";
import { recover } from "../state/recover.js";
import { applyBudgetOverrides } from "../state/schema.js";
import type { CallCategory, GoalSpec, RunState, Task, TaskGraph, Verdict } from "../state/schema.js";
import { intake } from "./intake.js";
import { decompose, type AgentCall } from "./decompose.js";
import { renderEscalationMd } from "./escalation-md.js";
import { notifyRunEnd } from "./notify.js";
import { enforceEvidenceRetention } from "../lib/evidence-retention.js";
import { loadContext, recordAttempt, saveContext, type ContextWindow } from "./context-window.js";
import { buildInstruction, summarizeInstruction } from "./instruct.js";
import { getVerdict } from "./verdict.js";
import { replanTask } from "./replan.js";
import { isOscillating, pushFingerprint } from "./progress.js";
import type { ProgressEmitter } from "./progress-io.js";
import { checkIntegrity } from "./integrity.js";
import { reviewGoal, materialFindings } from "./review.js";
import { checkBudgets, decide, onAgentFailure, type Decision } from "./strategy.js";
import type { ReviewFinding } from "../state/schema.js";

export type LoopOptions = {
  root: string;
  goalInput?: string;
  model?: string | null;
  /** override budgets (e.g. tests set a tiny global_turns). */
  budgets?: Partial<RunState["budgets"]>;
  /** injectable agent call; defaults to the real cursor-agent runner. */
  call?: AgentCall;
  /** live progress sink (the CLI passes a stderr renderer); omitted = silent. */
  progress?: ProgressEmitter;
  /**
   * Operator stop (the CLI aborts this on SIGINT/SIGTERM): the in-flight turn is
   * killed, its partial cost accounted, all state persisted, and the run parks
   * as `paused` for `agent-driver resume`.
   */
  stop?: AbortSignal;
  /** shell command fired on done/escalated (flag > GOAL.md Driver notify_cmd). */
  notify?: string;
  /** model for the brain calls only (decompose/verdict/review/replan); unset =
   *  identical behavior to before the knob existed. */
  brainModel?: string | null;
};

/** Repo-relative transcript path (one file per agent call). Composed from
 *  lib/paths.ts so the state layout has exactly one authority. */
function transcriptRelPath(root: string, basename: string): string {
  return path.relative(root, path.join(transcriptsDir(root), `${basename}.jsonl`));
}

const SYNTHETIC_COMPLETE: Verdict = {
  task_complete: true,
  confidence: 1,
  blockers: [],
  next_action: { kind: "none", instruction: "", rationale: "objective acceptance checks passed" },
};

async function escalate(
  root: string,
  run: RunState,
  reason: string,
  emit: ProgressEmitter = () => undefined,
  graph: TaskGraph | null = null,
): Promise<RunState> {
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
  // the human handoff: everything the run learned, plus the literal next commands
  try {
    const stuck = (graph?.tasks ?? []).filter((x) => x.status !== "done");
    const loaded = await Promise.all(stuck.map((t) => loadContext(root, t.id)));
    const contexts = new Map<string, ContextWindow>(stuck.map((t, i) => [t.id, loaded[i]]));
    await writeFile(escalationPath(root).replace(/\.json$/, ".md"), renderEscalationMd(run, graph, contexts), "utf8");
  } catch {
    /* the handoff document is best-effort; the escalation itself already persisted */
  }
  emit({ kind: "escalation", reason });
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
    scope: [],
    status: "pending",
    attempts: 0,
    approach: "default",
    last_failure: prose || null,
    last_failure_artifact: null,
    evidence: { proof_ptrs: [], tree: null },
  };
  return { tasks: [...graph.tasks, task] };
}

/** Turn each material review finding into a remediation task carrying its fix. */
function appendReviewRemediation(graph: TaskGraph, findings: ReviewFinding[]): TaskGraph {
  let tasks = [...graph.tasks];
  findings.forEach((f, i) => {
    tasks = [
      ...tasks,
      {
        id: `review.${graph.tasks.length + i + 1}`,
        title: `[${f.severity}/${f.area}] ${f.issue}`,
        kind: "remediate",
        deps: [],
        acceptance_checks: f.check ? [f.check] : [],
        acceptance_prose: f.fix,
        scope: [],
        status: "pending",
        attempts: 0,
        approach: "default",
        last_failure_artifact: null,
        last_failure: [
          `Issue: ${f.issue}`,
          f.evidence ? `Where: ${f.evidence}` : "",
          f.impact ? `Why it matters: ${f.impact}` : "",
          `Fix: ${f.fix}`,
        ]
          .filter(Boolean)
          .join("\n"),
        evidence: { proof_ptrs: [], tree: null },
      },
    ];
  });
  return { tasks };
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
  const emit: ProgressEmitter = opts.progress ?? (() => undefined);
  const stop = opts.stop ?? null;
  await ensureDriverDirs(root);

  /** Park the run for `resume`: persist everything, journal, release the lock by returning. */
  const pause = async (run: RunState, graph: TaskGraph, note: string): Promise<RunState> => {
    run.status = "paused";
    await saveGraph(root, graph);
    await saveRun(root, run);
    await appendJournal(root, { at: new Date().toISOString(), kind: "lifecycle", note });
    emit({ kind: "paused", turns: run.global_turns });
    return run;
  };

  return withDriverLock(root, async () => {
    // ── recover or init ────────────────────────────────────────────────────────
    // recover() owns resuming existing state: it reopens an in-progress task whose
    // recorded tree no longer matches (clearing its stale next_step) and journals
    // the resumption. Fresh repos fall through to init.
    const recovered = await recover(root);
    let run = recovered?.run ?? null;
    // an on-disk graph is authoritative even without a run.json (operators may
    // seed/edit task-graph.json before a first run)
    let graph = recovered?.graph ?? (await loadGraph(root));

    if (run && (run.status === "done" || run.status === "escalated")) return run;

    if (!run) {
      const spec: GoalSpec = await intake(opts.goalInput ?? "", root);
      run = await initRun(spec, root, opts.budgets);
      run.status = "decomposed";
      await saveRun(root, run);
    } else if (opts.budgets) {
      run.budgets = applyBudgetOverrides(run.budgets, opts.budgets);
    }
    run.driver_pid = process.pid;

    // THE single token-accounting site: the legacy total and the per-category
    // breakdown move together, so their sum-equals-total invariant cannot drift.
    const addTokens = (category: CallCategory, tokens: number): void => {
      if (!tokens) return;
      (run as RunState).consumed.tokens += tokens;
      (run as RunState).consumed.tokens_by_category[category] += tokens;
    };

    // model precedence: CLI flag > GOAL.md `## Driver` default > agent's own default
    const model = opts.model ?? run.goal_spec.driver_defaults?.model ?? null;
    const notifyCmd = opts.notify ?? run.goal_spec.driver_defaults?.notify_cmd;

    // Brain-model routing (opt-in): the high-frequency structured-output calls
    // (decompose/verdict/review/replan) may run on a cheaper model while edit
    // turns keep the strong one. One knob, one wrapper — unset means brainCall
    // IS call, so the argv is byte-identical to before the knob existed.
    const brainModel = opts.brainModel ?? run.goal_spec.driver_defaults?.brain_model ?? null;
    const brainCall: AgentCall = brainModel
      ? (callOpts) => call({ ...callOpts, model: callOpts.model ?? brainModel })
      : call;
    if (brainModel) {
      await appendJournal(root, {
        at: new Date().toISOString(),
        kind: "lifecycle",
        note: `brain model: ${brainModel} (edit turns: ${model ?? "agent default"})`,
      });
    }

    if (!graph) {
      const dec = await decompose(run.goal_spec, root, brainCall, path.join(root, transcriptRelPath(root, "decompose")));
      addTokens("decompose", dec.tokens);
      graph = materializeGraph(dec.graph);
      await saveGraph(root, graph);
      await appendJournal(root, {
        at: new Date().toISOString(),
        kind: "lifecycle",
        note: `decomposed into ${graph.tasks.length} tasks via ${dec.source}${dec.error ? ` (${dec.error})` : ""}`,
      });
      emit({ kind: "decomposed", tasks: graph.tasks.length, source: dec.source });
      // Goal-level synthesis: the strongest gate in the system must not sit empty
      // just because the goal arrived as a one-line prompt. Planner authority is
      // weaker than human authority — adopt ONLY into emptiness, never override.
      if (!run.goal_spec.acceptance_checks.length && dec.goalChecks?.length) {
        run.goal_spec.acceptance_checks = [...dec.goalChecks];
        run.proposed_goal_checks = [...dec.goalChecks];
        await saveRun(root, run);
        await appendJournal(root, {
          at: new Date().toISOString(),
          kind: "lifecycle",
          note: `goal checks proposed by planner (adopted; none were human-given): ${dec.goalChecks.join("; ")}`,
        });
        emit({ kind: "goal_checks", checks: dec.goalChecks });
      }
    }

    run.status = "running";
    await saveRun(root, run);

    /** Terminal-state exit: escalate, then ping the operator (notify never affects outcome). */
    const escalateAndNotify = async (reason: string): Promise<RunState> => {
      const r = await escalate(root, run as RunState, reason, emit, graph);
      await notifyRunEnd(root, r, notifyCmd);
      return r;
    };

    // ── outer loop ─────────────────────────────────────────────────────────────
    while (true) {
      if (stop?.aborted) return pause(run, graph, "paused by operator before a turn started");

      const budget = checkBudgets(run);
      if (budget.breached) return escalateAndNotify(budget.reason ?? "budget exhausted");

      const task = selectTask(graph, run);
      if (!task) {
        if (allTasksDone(graph)) break;
        return escalateAndNotify("no ready task (dependency deadlock)");
      }

      task.status = "in_progress";
      run.active_task = task.id;
      const ctx = await loadContext(root, task.id);
      const sid = run.session_map[task.id] ?? null;
      const isFresh = !sid;
      const preTree = workingTreeFingerprint(root);
      const instruction = buildInstruction(run.goal_spec, task, ctx, ctx.next_step || null, isFresh);

      emit({
        kind: "turn_start",
        turn: run.global_turns + 1,
        taskId: task.id,
        title: task.title,
        attempt: task.attempts + 1,
        fresh: isFresh,
      });
      // The full NDJSON stream is operator-facing evidence (teed live, so a hung
      // or crashed turn still leaves it); prompts never include it.
      const transcriptRel = transcriptRelPath(root, `${run.global_turns + 1}-${task.id}`);
      const turnStart = Date.now();
      let result;
      try {
        result = await call({
          instruction,
          resume: sid,
          mode: "edit",
          root,
          model,
          transcriptPath: path.join(root, transcriptRel),
          signal: stop ?? undefined,
        });
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

      // Operator stop mid-turn: the child was killed, not failed. Account the
      // partial turn honestly (cost, journal, session) WITHOUT charging the task
      // an attempt or running acceptance, then park for resume. A turn that
      // COMPLETED before the signal landed (success, no kill) is real finished
      // work — process it normally; the top-of-loop check pauses before the next
      // turn instead of misrecording a successful turn as aborted.
      if (stop?.aborted && result.terminal !== "success") {
        if (result.sessionId) run.session_map[task.id] = result.sessionId;
        run.global_turns += 1;
        addTokens("edit", usageTokens(result.usage));
        run.consumed.wall_ms += elapsed;
        await appendJournal(root, {
          at: new Date().toISOString(),
          kind: "turn",
          task_id: task.id,
          global_turn: run.global_turns,
          terminal: result.terminal,
          tokens: usageTokens(result.usage),
          note: "turn interrupted by operator stop",
          transcript: transcriptRel,
        });
        await saveContext(root, ctx);
        return pause(run, graph, `paused by operator during turn ${run.global_turns}`);
      }

      if (result.sessionId) run.session_map[task.id] = result.sessionId;
      run.global_turns += 1;
      task.attempts += 1;
      addTokens("edit", usageTokens(result.usage));
      run.consumed.wall_ms += elapsed;

      const postTree = workingTreeFingerprint(root);
      const progressed = postTree !== preTree;
      task.evidence.tree = postTree;
      const turnToolRuns = await readToolRunsSince(root, turnStart);
      task.evidence.proof_ptrs = mergeProofPtrs(task.evidence.proof_ptrs, turnToolRuns);
      if (existsSync(path.join(root, transcriptRel)) && !task.evidence.proof_ptrs.includes(transcriptRel)) {
        task.evidence.proof_ptrs.push(transcriptRel);
      }

      await appendJournal(root, {
        at: new Date().toISOString(),
        kind: "turn",
        task_id: task.id,
        global_turn: run.global_turns,
        terminal: result.terminal,
        progressed,
        tokens: usageTokens(result.usage),
        note: summarizeInstruction(instruction),
        transcript: transcriptRel,
      });

      let decision: Decision;
      let checkFails: string[] = [];

      if (result.terminal !== "success") {
        // Contract drift is environmental, not task failure — name it so neither the
        // operator nor the agent chases a phantom bug. (Kills/crashes never classify
        // as drift; see stream.ts classifyAnomaly.)
        let failureText = result.finalText;
        if (result.anomaly) {
          failureText = [
            `CONTRACT-DRIFT: ${result.anomaly.detail}`,
            result.rawSample?.length ? `raw stream sample:\n${result.rawSample.join("\n")}` : "",
            "This looks like a cursor-agent stream contract change, not a task failure.",
            "Run 'agent-driver doctor --probe' to validate the contract.",
            result.finalText,
          ]
            .filter(Boolean)
            .join("\n\n");
          await appendJournal(root, {
            at: new Date().toISOString(),
            kind: "lifecycle",
            task_id: task.id,
            note: `CONTRACT-DRIFT suspected: ${result.anomaly.detail}`,
          });
        }
        const failArtifact = await writeTurnFailureArtifact(root, task.id, run.global_turns, failureText);
        ctx.last_failure = failureText;
        ctx.last_failure_artifact = failArtifact;
        task.last_failure = failureText;
        task.last_failure_artifact = failArtifact;
        decision = onAgentFailure(run, task);
      } else {
        // A successful turn whose stream never carried a session_id can't be
        // resumed — flag the contract suspicion without failing honest work.
        if (result.anomaly?.kind === "missing-session-id") {
          await appendJournal(root, {
            at: new Date().toISOString(),
            kind: "lifecycle",
            task_id: task.id,
            note: `CONTRACT-DRIFT suspected: ${result.anomaly.detail} (run 'agent-driver doctor --probe')`,
          });
        }
        const acceptance = await runTaskAcceptance(root, task);
        run.no_progress_streak = progressed ? 0 : run.no_progress_streak + 1;
        const oscillating = isOscillating(run, postTree);
        pushFingerprint(run, postTree);
        checkFails = acceptance.results.filter((r) => !r.ok).map((r) => r.cmd);
        const diffFiles = listDiffFiles(root);

        // Reward-hacking / scope-creep guard: blocks completion even if checks pass.
        // The task's own fence (when the planner proposed one) applies per turn;
        // the goal-level gate below still enforces the goal scope as the outer bound.
        const integrityIssues = checkIntegrity(root, diffFiles, run.goal_spec.scope, task.scope);

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
            turnStart,
            brainCall,
            path.join(root, transcriptRelPath(root, `verdict-${run.global_turns}`)),
          );
          addTokens("verdict", vr.tokens);
          verdict = vr.verdict;
        }

        const failNotes: string[] = [];
        if (acceptance.results.some((r) => !r.ok)) {
          failNotes.push(formatCheckFailuresFull(acceptance.results.filter((r) => !r.ok)));
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
          const fullFail = failNotes.join("\n");
          const failArtifact = await writeTurnFailureArtifact(root, task.id, run.global_turns, fullFail);
          ctx.last_failure = fullFail;
          ctx.last_failure_artifact = failArtifact;
          task.last_failure = fullFail;
          task.last_failure_artifact = failArtifact;
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

      emit({
        kind: "turn_end",
        turn: run.global_turns,
        taskId: task.id,
        terminal: result.terminal,
        tokens: usageTokens(result.usage),
        elapsedMs: elapsed,
        decision: decision.kind,
        reason: decision.reason,
      });

      // ── apply decision ────────────────────────────────────────────────────────
      switch (decision.kind) {
        case "task_done":
          task.status = "done";
          ctx.next_step = "";
          run.active_task = null;
          // never mid-task (the active task's artifacts are hot) — only here and at run end
          await enforceEvidenceRetention(root, run, graph);
          break;
        case "continue_same_session":
          ctx.next_step = decision.instruction ?? "";
          break;
        case "switch_approach":
          delete run.session_map[task.id];
          task.approach = decision.instruction ?? "alternative approach";
          if (decision.instruction && !ctx.tried_approaches.includes(decision.instruction)) {
            ctx.tried_approaches.push(decision.instruction);
          }
          ctx.next_step = "";
          break;
        case "replan": {
          const replanned = await replanTask(
            graph,
            task,
            decision.reason,
            run.goal_spec,
            root,
            brainCall,
            path.join(root, transcriptRelPath(root, `replan-${task.id}`)),
          );
          addTokens("replan", replanned.tokens);
          if (replanned.graph) {
            graph = replanned.graph;
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
            return escalateAndNotify(`replan failed for ${task.id}: ${decision.reason}`);
          }
          break;
        }
        case "escalate":
          await saveContext(root, ctx);
          await saveGraph(root, graph);
          return escalateAndNotify(decision.reason);
      }

      await saveContext(root, ctx);
      await saveGraph(root, graph);
      await saveRun(root, run);

      // ── goal-level stop gate ──────────────────────────────────────────────────
      if (allTasksDone(graph)) {
        let goalAcceptance = await runGoalAcceptance(root, run.goal_spec);

        // A hallucinated planner-proposed check whose COMMAND does not exist would
        // deadlock the gate into remediation forever. "Unrunnable" is the shell's
        // verdict (exit 127), never an output-text guess — `cat missing-deliverable`
        // fails with exit 1 and "No such file or directory" and must stay a real,
        // remediable failure. Human-given checks are never dropped — they are the
        // contract. The surviving results are filtered in place (re-running the
        // gate would pay every remaining check twice; a `continue` would skip it).
        const unrunnable = goalAcceptance.results.filter(
          (r) => !r.ok && r.exitCode === 127 && run.proposed_goal_checks.includes(r.cmd),
        );
        if (unrunnable.length) {
          const dropped = unrunnable.map((r) => r.cmd);
          run.goal_spec.acceptance_checks = run.goal_spec.acceptance_checks.filter((c) => !dropped.includes(c));
          run.proposed_goal_checks = run.proposed_goal_checks.filter((c) => !dropped.includes(c));
          await saveRun(root, run);
          await appendJournal(root, {
            at: new Date().toISOString(),
            kind: "lifecycle",
            note: `DROPPED unrunnable planner-proposed goal check(s): ${dropped.join("; ")} — shell exit 127 (command not found); the gate continues with the remaining checks`,
          });
          const surviving = goalAcceptance.results.filter((r) => !dropped.includes(r.cmd));
          goalAcceptance = {
            results: surviving,
            objective: surviving.length > 0,
            allPass: surviving.every((r) => r.ok),
          };
        }

        const goalIntegrity = checkIntegrity(root, listDiffFiles(root), run.goal_spec.scope);
        const checksOk = !goalAcceptance.objective || goalAcceptance.allPass;
        if (checksOk && goalIntegrity.length === 0) {
          // ── excellence gate: review until satisfied or diminishing returns ──────────
          // Stops on genuine satisfaction or when rounds stop reducing material findings
          // (the agent can't resolve them) — not at an arbitrary count. review_rounds is a
          // far-off safety cap only.
          if (run.budgets.review_rounds > 0 && run.review_rounds_done < run.budgets.review_rounds) {
            const { review, source, tokens: reviewTokens } = await reviewGoal(
              run.goal_spec,
              root,
              brainCall,
              path.join(root, transcriptRelPath(root, `review-${run.review_rounds_done + 1}`)),
            );
            addTokens("review", reviewTokens);
            run.review_rounds_done += 1;
            const material = source === "llm" && !review.satisfied ? materialFindings(review) : [];
            if (material.length) {
              const improving = run.review_rounds_done === 1 || material.length < run.review_prev_material;
              run.review_stall = improving ? 0 : run.review_stall + 1;
              run.review_prev_material = material.length;
              if (run.review_stall < 2) {
                graph = appendReviewRemediation(graph, material);
                run.active_task = null;
                await saveGraph(root, graph);
                await appendJournal(root, {
                  at: new Date().toISOString(),
                  kind: "lifecycle",
                  note: `review round ${run.review_rounds_done}: ${material.length} material finding(s) → remediation (${material
                    .map((f) => `${f.severity}/${f.area}`)
                    .join(", ")})`,
                });
                await saveRun(root, run);
                emit({ kind: "review", round: run.review_rounds_done, material: material.length, satisfied: false, residual: false });
                continue; // drive the remediation tasks, then re-review
              }
              // not converging — ship, recording the residual findings honestly
              run.residual_findings = material;
              await appendJournal(root, {
                at: new Date().toISOString(),
                kind: "lifecycle",
                note: `review not converging after ${run.review_rounds_done} rounds; shipping with ${material.length} residual finding(s): ${material
                  .map((f) => `${f.severity}/${f.area}`)
                  .join(", ")}`,
              });
              emit({ kind: "review", round: run.review_rounds_done, material: material.length, satisfied: false, residual: true });
            } else {
              await appendJournal(root, {
                at: new Date().toISOString(),
                kind: "lifecycle",
                note:
                  source === "skip"
                    ? "review skipped (reviewer unavailable)"
                    : `review round ${run.review_rounds_done}: satisfied — shipping`,
              });
              if (source === "llm") {
                emit({ kind: "review", round: run.review_rounds_done, material: 0, satisfied: true, residual: false });
              }
            }
          }
          run.status = "done";
          run.active_task = null;
          await appendJournal(root, {
            at: new Date().toISOString(),
            kind: "lifecycle",
            note: goalAcceptance.objective ? "goal acceptance checks pass" : "all tasks done (no goal-level checks)",
          });
          await saveRun(root, run);
          if (existsSync(escalationPath(root))) await rm(escalationPath(root)).catch(() => undefined);
          await enforceEvidenceRetention(root, run, graph);
          emit({ kind: "done", turns: run.global_turns });
          await notifyRunEnd(root, run, notifyCmd);
          return run;
        }
        const failing = goalAcceptance.results.filter((r) => !r.ok).map((r) => r.cmd);
        const prose = goalIntegrity.length
          ? `Undo the integrity violation while keeping checks green: ${goalIntegrity.join("; ")}`
          : "";
        graph = appendRemediationTasks(graph, failing, prose);
        await saveGraph(root, graph);
        const remediationNote = goalIntegrity.length
          ? `goal-level integrity violation (${goalIntegrity.join("; ")}); added remediation task`
          : `goal checks failing (${failing.join(", ")}); added remediation task`;
        await appendJournal(root, {
          at: new Date().toISOString(),
          kind: "lifecycle",
          note: remediationNote,
        });
        emit({ kind: "remediation", note: remediationNote });
      }
    }

    run.status = "done";
    await saveRun(root, run);
    emit({ kind: "done", turns: run.global_turns });
    await notifyRunEnd(root, run, notifyCmd);
    return run;
  });
}
