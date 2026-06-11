# agent-driver architecture

A driver process drives the stock `cursor-agent` CLI to fully realize a goal. It does not patch Cursor; it spawns headless turns and reads their `stream-json` output.

## The contract it relies on (from cursor-agent)

- `cursor-agent --print --output-format stream-json` runs **one** turn and emits NDJSON; every event carries `session_id`, and the final event is `{type:"result", subtype:"success", result, session_id, usage}`.
- The stop-hook `followup_message` auto-continuation runs **only in the interactive Ink UI**, never in headless `--print`. So continuation cannot be delegated to a hook — the driver must own it.
- `--resume <session_id>` continues a prior session; `--mode plan|ask` are read-only.
- Tool hooks (`preToolUse`/`postToolUse`) fire headless via the shared exec engine and honor `{permission, updated_input, agent_message}`; `beforeShellExecution` does **not** fire headless, so destructive-shell denial is placed on `preToolUse`.

## Modules (`packages/driver/src`)

- `driver/loop.ts` — the outer loop. Owns continuation via `--resume`, the graceful-stop pause path, the goal gate, the excellence gate, and run-end notification.
- `driver/intake.ts` — `GOAL.md` or prompt → goal spec, including the `## Driver` per-goal config section (`parseDriverSection`) and HTML-comment masking shared with the linter.
- `driver/decompose.ts` — `--mode ask` call → ajv-validated task graph (acyclic, deps resolvable, per-task scopes that may only narrow the goal scope; no arbitrary size caps). Proposes goal-level checks for freeform prompts (adopted only when the human gave none). Falls back to a single task if the planner can't produce valid output.
- `driver/instruct.ts` — builds the per-turn instruction from the task + accumulated context (the fix for context starvation). Renders OPERATOR GUIDANCE from `steer` above model steering, below acceptance.
- `driver/verdict.ts` — `--mode ask` call judging driver-supplied evidence (acceptance results + hook-captured tool runs from `tool-runs.jsonl` with artifact pointers); objective checks are preferred and the LLM is skipped when they decide it; malformed JSON falls back to an objective decision.
- `driver/strategy.ts` — budgets + the ladder: retry → replan → switch_approach → escalate.
- `driver/progress.ts` — no-progress and oscillation detection over the working-tree fingerprint.
- `driver/replan.ts` — break a stuck task into subtasks the parent then depends on (subtasks inherit/narrow the parent's scope fence).
- `driver/progress-io.ts` — typed progress events the loop emits; the CLI renders them to stderr live (`--quiet` off).
- `driver/integrity.ts` — reward-hack + scope-creep detection; the fence is per-task when the planner proposed one.
- `driver/review.ts` — the adversarial excellence gate reviewer.
- `driver/resume.ts` / `driver/steer.ts` / `driver/reset.ts` — the operator verbs: continue an escalated/paused run (attempt + detector reset, budget-breach refusal), inject one-line guidance into a task's context, archive a run under `runs/` for a fresh goal.
- `driver/escalation-md.ts` — renders `ESCALATION.md`, the human handoff written on escalate.
- `driver/logs.ts` / `driver/diff.ts` / `driver/report.ts` — read-only operator surfaces over the journal, the intake baseline, and the whole run state (`RUN_REPORT.md`).
- `driver/goal-lint.ts` — static GOAL.md validation (prose-as-shell checks, dead scope paths, duplicate sections).
- `driver/probe.ts` — `doctor --probe`: two tiny real turns through the actual runner validating the stream contract.
- `driver/notify.ts` — fires the operator's `notify_cmd` on done/escalated (JSON summary on stdin; failures journaled, never affect the run).
- `agent/runner.ts` + `agent/stream.ts` — spawn cursor-agent, parse the NDJSON stream, capture `session_id`, usage, and terminal status; tee the raw stream to a per-turn transcript; classify contract anomalies (`CONTRACT-DRIFT`) conservatively — kills and crashes are never drift; an `abort` reason distinguishes operator stops from watchdog timeouts.
- `state/` — schema, atomic store (intake baseline capture in `initRun`), crash recovery (`recover()` is called by the loop; a stale in-progress task is reopened and its stale next-step cleared).
- `lib/` — git fingerprint + baseline diff helpers, POSIX lock, check runner, journal, shell policy, evidence retention (oldest-first rotation past `evidence_cap_mb`, never dropping artifacts a live task or residual finding references).
- `hooks/safety-net.ts` + `bridge/hook-next.ts` — the thin 3-event hook net (destructive-shell deny, tool evidence capture, interactive stop nudge) and the `driver next` bridge. Hooks are a net, not a dependency: the headless loop owns continuation via `--resume` even if hooks never fire.
- `lib/progressive-reveal.ts` — bulky evidence (tool output, check logs, turn failures) is stored in full under `evidence/`; LLM prompts get a preview plus an artifact path. Acceptance criteria, goals, and steering text stay entire.
- `lib/tool-runs.ts` — reads `tool-runs.jsonl` rows since turn start; feeds the verdict prompt and appends `output_artifact` paths to `task.evidence.proof_ptrs`.

## The loop

```
intake (+ baseline capture) → decompose (+ goal-check synthesis) → for each ready task:
  build instruction (goal + acceptance + operator guidance + what-was-tried)
  spawn cursor-agent --print [--resume session]   # capture session_id; tee transcript
  run acceptance checks; compute progressed = tree changed
  integrity guard (reward-hack + per-task scope fence)
  verdict = objective-pass ? done : ask-mode judgment
  decide: done | continue(--resume) | replan | switch(fresh session) | escalate
  persist atomically; emit live progress
when all tasks done → goal-level checks + integrity → excellence-gate review
  → done (notify), else add remediation tasks
```

Budgets (turns, attempts, tokens, wall-clock), a no-progress streak, and an oscillation ring bound every run; any breach escalates with an `ESCALATION.json` + `ESCALATION.md` handoff. An `error`/`aborted` turn is never counted as done. An operator stop (Ctrl-C) parks the run as `paused` for `resume`; a clean-exit stream that violates the NDJSON contract is flagged `CONTRACT-DRIFT`, not blamed on the task.

## State (`.cursor/goal/driver/`)

`run.json` (status, budgets, consumed, session map, fingerprint ring, intake baseline, planner-proposed goal checks), `task-graph.json`, `journal.jsonl`, `context/<taskId>.json` (full failure text + artifact paths + operator guidance), `evidence/` (`proof-runs.jsonl`, `tool-runs.jsonl`, `tool-outputs/`, `turn-failures/`, `turns/` full per-turn NDJSON transcripts, `baseline/` pre-run dirty snapshot), `ESCALATION.json` + `ESCALATION.md`, `runs/` (archives from `reset`). All writes are atomic; a crashed run resumes from disk and re-verifies any task whose recorded tree no longer matches. Bulky evidence rotates oldest-first past `evidence_cap_mb` without ever dropping artifacts a live task or residual finding references.

## Two surfaces, one engine

Headless `agent-driver run` pumps turns itself. In an interactive Cursor session the `stop` hook calls `driver next`, which computes the next action through the same strategy code and returns it as a `followup_message` for Cursor's native loop to inject.
