# agent-driver RUNBOOK

Operator guide for running and recovering long-horizon `cursor-agent` runs.

## Install

```bash
npm install
npm run build
npm run install:global            # stage under ~/.cursor/agent-driver + register hooks
npm run install:global -- --profile   # also write ~/.cursor/cursor-goal.env (PATH)
source ~/.cursor/cursor-goal.env  # if you used --profile
agent-driver doctor               # confirm cursor-agent is resolvable
```

Per-repo only (no global): `bash core/install.sh`.

## Run a goal

```bash
# Freeform:
agent-driver run "Add a /health endpoint with a passing test"

# Or define GOAL.md (## Goal + ## Checks as backticked commands), then:
agent-driver run

# Useful flags:
agent-driver run --max-turns 20 --model sonnet-4 "…"
agent-driver run --dry-run "…"     # decompose + print, no edits
```

Exit codes: `0` done, `2` escalated, `1` otherwise.

## Inspect

```bash
agent-driver status      # goal, run status, turn/token budgets, task graph
agent-driver verify      # run the goal-level acceptance checks now
```

## State (`.cursor/goal/driver/`)

| File | What |
|------|------|
| `run.json` | status, budgets, consumed tokens/wall, session map, fingerprint ring |
| `task-graph.json` | tasks, deps, acceptance, status, attempts — human-editable between runs |
| `journal.jsonl` | every turn + decision (append-only) |
| `context/<id>.json` | per-task accumulated context (what was tried, last failure) |
| `evidence/` | check outputs (`proof-runs.jsonl`), tool runs (`tool-runs.jsonl`) |
| `ESCALATION.json` | written when a run escalates |

## When a run escalates

`status: escalated` plus `ESCALATION.json` with the reason (attempt/turn/token/wall budget, dependency deadlock, or an agent that kept failing). Options:

- Read `journal.jsonl` and the failing `evidence/proof-runs.jsonl` to see what blocked.
- Edit `task-graph.json` (split a task, fix acceptance) and re-run `agent-driver run` — it resumes from disk.
- Raise a budget for the next run with `--max-turns`, or narrow the goal.

## Recovery

A crashed `agent-driver run` resumes automatically: state is written atomically each turn, so the worst case is re-running one turn. A task whose recorded working-tree fingerprint no longer matches is reopened for re-verification rather than trusted as done. Resuming reuses each task's captured `session_id` via `--resume`.

## Interactive (no driver process)

With the hooks installed, an interactive Cursor session that stops mid-goal gets a `followup_message` from `agent-driver next` (computed by the same strategy code) nudging it toward the next task — bounded by the same turn budget.

## Uninstall

```bash
npm run uninstall:global   # remove hooks + ~/.cursor/agent-driver
```
