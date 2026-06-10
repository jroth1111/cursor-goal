# agent-driver architecture

A driver process drives the stock `cursor-agent` CLI to fully realize a goal. It does not patch Cursor; it spawns headless turns and reads their `stream-json` output.

## The contract it relies on (from cursor-agent)

- `cursor-agent --print --output-format stream-json` runs **one** turn and emits NDJSON; every event carries `session_id`, and the final event is `{type:"result", subtype:"success", result, session_id, usage}`.
- The stop-hook `followup_message` auto-continuation runs **only in the interactive Ink UI**, never in headless `--print`. So continuation cannot be delegated to a hook — the driver must own it.
- `--resume <session_id>` continues a prior session; `--mode plan|ask` are read-only.
- Tool hooks (`preToolUse`/`postToolUse`) fire headless via the shared exec engine and honor `{permission, updated_input, agent_message}`; `beforeShellExecution` does **not** fire headless, so destructive-shell denial is placed on `preToolUse`.

## Modules (`packages/driver/src`)

- `driver/loop.ts` — the outer loop. Owns continuation via `--resume`.
- `driver/intake.ts` — `GOAL.md` or prompt → goal spec.
- `driver/decompose.ts` — `--mode plan` call → ajv-validated task graph (acyclic, deps resolvable). Falls back to a single task if the planner can't produce valid output.
- `driver/instruct.ts` — builds the per-turn instruction from the task + accumulated context (the fix for context starvation).
- `driver/verdict.ts` — `--mode ask` call judging driver-supplied evidence; objective checks are preferred and the LLM is skipped when they decide it; malformed JSON falls back to an objective decision.
- `driver/strategy.ts` — budgets + the ladder: retry → replan → switch_approach → escalate.
- `driver/progress.ts` — no-progress and oscillation detection over the working-tree fingerprint.
- `driver/replan.ts` — break a stuck task into subtasks the parent then depends on.
- `agent/runner.ts` + `agent/stream.ts` — spawn cursor-agent, parse the NDJSON stream, capture `session_id`, usage, and terminal status.
- `state/` — ajv schema, atomic store, crash recovery.
- `lib/` — git fingerprint, POSIX lock, check runner, journal, shell policy.
- `hooks/safety-net.ts` + `bridge/hook-next.ts` — the thin hook and the interactive `driver next` bridge.

## The loop

```
intake → decompose → for each ready task:
  build instruction (goal + acceptance + what-was-tried)
  spawn cursor-agent --print [--resume session]   # capture session_id
  run acceptance checks; compute progressed = tree changed
  verdict = objective-pass ? done : ask-mode judgment
  decide: done | continue(--resume) | replan | switch(fresh session) | escalate
  persist atomically
when all tasks done → run goal-level checks → done, else add remediation tasks
```

Budgets (turns, attempts, tokens, wall-clock), a no-progress streak, and an oscillation ring bound every run; any breach escalates with an `ESCALATION.json` handoff. An `error`/`aborted` turn is never counted as done.

## State (`.cursor/goal/driver/`)

`run.json` (status, budgets, consumed, session map, fingerprint ring), `task-graph.json`, `journal.jsonl`, `context/<taskId>.json`, `evidence/`. All writes are atomic; a crashed run resumes from disk and re-verifies any task whose recorded tree no longer matches.

## Two surfaces, one engine

Headless `agent-driver run` pumps turns itself. In an interactive Cursor session the `stop` hook calls `driver next`, which computes the next action through the same strategy code and returns it as a `followup_message` for Cursor's native loop to inject.
