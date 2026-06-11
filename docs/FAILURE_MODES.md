# Failure-mode coverage

How `agent-driver` mitigates the failure modes a coding agent like cursor-agent commonly exhibits on long-horizon work. Each row names the concrete mechanism and where it lives. The driver's stance: **machine checks and the driver's own observations decide outcomes — never the agent's self-report.**

| # | Failure mode | Mitigation | Where |
|---|--------------|------------|-------|
| 1 | Declares "done" while incomplete | Objective acceptance checks decide; the agent's claim never overrides them | `driver/strategy.ts` `decide`, `checks/acceptance.ts` |
| 2 | Hallucinated success (claims it ran tests, didn't) | The driver runs the checks itself, independent of the agent | `lib/checks.ts` `runChecks`, `checks/acceptance.ts` |
| 3 | Reward-hacking: passes checks by weakening/skipping/deleting verification (`\|\| true`, `.skip`, deleted tests, `--passWithNoTests`) | Tamper detection over the turn's diff blocks completion even when checks pass | `driver/integrity.ts` `detectTamper`, gated in `strategy.ts` |
| 4 | Games the criteria by editing the goal/checks | Checks are pinned at intake into `run.json` / the task graph; runtime ignores later `GOAL.md` edits | `state/store.ts` `initRun`, loop reads `run.goal_spec.acceptance_checks` |
| 5 | Scope creep: edits unrelated files | Out-of-scope edits block completion and are fed back. The fence is per-task when the planner proposed one (task scopes may only narrow the goal scope), else `GOAL.md` `## Scope`; the goal-level gate always enforces the goal scope | `driver/integrity.ts` `checkIntegrity`/`outOfScopeEdits`, `state/schema.ts` `validateGraphSemantics` |
| 6 | Destructive commands (`rm -rf`, `git push --force`, `drop database`) | `preToolUse` safety-net denies (headless + interactive); check runner refuses too | `hooks/safety-net.ts`, `lib/shell-allow.ts` |
| 7 | Runaway / infinite loop / cost blowup | Hard budgets — turns, per-task attempts, tokens, wall-clock — checked every turn; `--max-turns` | `driver/strategy.ts` `checkBudgets`, `state/schema.ts` `DEFAULT_BUDGETS` |
| 8 | No-progress spinning | Working-tree fingerprint unchanged across N turns climbs the ladder | `driver/progress.ts` no-progress streak |
| 9 | Oscillation (undo→redo thrash) | Fingerprint ring detects A→B→A → `switch_approach`, never a plain retry | `driver/progress.ts` `isOscillating` |
| 10 | Gives up too early | Strategy ladder: retry → replan → switch_approach → escalate, bounded by attempts | `driver/strategy.ts` |
| 11 | Context loss across a long horizon / compaction | Per-task context window ("tried X, failed because Y, don't repeat") injected each turn; full history kept server-side via `--resume` | `driver/context-window.ts`, `driver/instruct.ts` |
| 12 | Crash mid-run → lost/corrupt state | Atomic per-turn persist; `runGoal` resumes via `recover()`, which reopens an in-progress task whose recorded tree no longer matches and clears its stale `next_step` so the next instruction re-establishes ground truth | `lib/paths.ts` `atomicWriteJson`, `state/recover.ts` (called from `driver/loop.ts`) |
| 13 | Aborted/errored turn slips through as "done" | `terminal != success` is never completion; routed to the failure ladder | `agent/stream.ts` `terminalFor`, `strategy.ts` `onAgentFailure` |
| 14 | Bad / cyclic / deadlocked plan | ajv schema + semantic validation (acyclic, deps resolvable); deadlock → escalate; replan can split or merge | `state/schema.ts` `validateGraphSemantics`, `driver/replan.ts` |
| 15 | Hung / runaway single command | Per-turn timeout (SIGTERM→SIGKILL) and per-check timeout | `agent/runner.ts`, `lib/checks.ts` `checkTimeoutMs` |
| 16 | Malformed planner/verdict output | ajv validation + one retry + safe fallback (single-task graph / objective-checks verdict) | `driver/decompose.ts`, `driver/verdict.ts` |
| 17 | Goal drift (loses sight of the goal) | Goal anchored in every instruction; authoritative goal-level acceptance gate before "done" | `driver/instruct.ts`, `driver/loop.ts` |
| 18 | Commits/pushes without consent | Never auto-commits; force-push denied by policy; instruction forbids committing | `hooks/safety-net.ts`, `driver/instruct.ts` |
| 19 | Partial work reported as complete | Per-task acceptance gate *and* a separate goal-level gate (with integrity re-check) | `driver/loop.ts` goal-level stop gate |
| 20 | Repeats a failed approach | `tried_approaches` + `last_failure` carried forward into the next instruction | `driver/context-window.ts` |

## Honest limits

- **Within-turn hallucination** (wrong API, fabricated import) is not prevented mid-generation — it surfaces as a failing acceptance check or build, which the driver then drives to fix. The guarantee is *behavioral* (the checks must pass), not that any single turn is correct.
- **Reward-hack detection is heuristic.** It catches the common tells; a sufficiently creative bypass could evade the pattern set. It is conservative (blocks on suspicion, lets the human adjudicate via escalation) rather than exhaustive.
- **Secret exfiltration / reading sensitive files** is not specifically gated — `beforeReadFile` does not fire in headless mode, so the reliable interception points are shell (`preToolUse`) and the check runner. Run untrusted goals in a sandbox or worktree.
- **Quality beyond acceptance** (readability, architecture) is only as good as the goal's checks demand. Acceptance is a floor, not a ceiling.
