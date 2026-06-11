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
agent-driver doctor --probe       # ALSO run two tiny real turns to validate the
                                  # stream contract — run after every cursor-agent upgrade
```

Per-repo only (no global): `bash core/install.sh`.

## Run a goal

```bash
# Freeform:
agent-driver run "Add a /health endpoint with a passing test"

# Or define GOAL.md (## Goal + ## Checks as backticked commands), then:
agent-driver run

# GOAL.md may also carry per-goal run config in a `## Driver` section
# (- model: …, - brain_model: …, - max_turns: …, - review_rounds: …,
#  - task_attempts: …, - notify_cmd: …, - evidence_cap_mb: …). CLI flags override it.

# Useful flags:
agent-driver run --max-turns 20 --model sonnet-4 "…"
agent-driver run --dry-run "…"     # lint GOAL.md + decompose + print, no edits
agent-driver run --quiet "…"       # suppress the live stderr progress feed
agent-driver run --notify 'curl -s -X POST -d @- https://example.test/hook' "…"
#   notify runs on done/escalated with a JSON summary on stdin and
#   AGENT_DRIVER_STATUS / AGENT_DRIVER_ROOT in env. macOS desktop alert:
#   --notify 'osascript -e "display notification \"$AGENT_DRIVER_STATUS\" with title \"agent-driver\""'

# Validate GOAL.md authoring before a run:
agent-driver lint                  # --strict exits 1 on errors

# Isolate the run in a disposable git worktree (your checkout is untouched):
agent-driver run --worktree "…"
#   work lands uncommitted on branch agent-driver/<id> under .cursor/goal/worktrees/;
#   the end-of-run summary shows the diff and the adopt/discard commands.
#   Sharp edge: node_modules/build caches do NOT follow a worktree — checks that
#   need installed deps must install there. Leftovers: `git worktree list`,
#   `git worktree remove --force <path>`.
```

Exit codes: `0` done, `2` escalated, `130` paused (Ctrl-C), `1` otherwise.

Ctrl-C during a run pauses gracefully: the in-flight turn is killed, its partial
cost is accounted, state persists, and `agent-driver resume` continues. A second
Ctrl-C force-quits (the stale-lock reaper cleans up).

## Inspect

```bash
agent-driver status      # goal, run status, turn/token budgets, task graph
agent-driver verify      # run the goal-level acceptance checks now
agent-driver logs        # pretty-print the journal
agent-driver logs --task t1 --kind decision --tail 20
agent-driver logs --follow   # live-tail while a run is going
agent-driver diff        # run changes vs the intake baseline (--full for the patch)
agent-driver report      # write RUN_REPORT.md — paste it into a PR description
```

## State (`.cursor/goal/driver/`)

| File | What |
|------|------|
| `run.json` | status, budgets, consumed tokens/wall, session map, fingerprint ring, intake baseline |
| `task-graph.json` | tasks, deps, acceptance, status, attempts — human-editable between runs |
| `journal.jsonl` | every turn + decision (append-only; read it with `agent-driver logs`) |
| `context/<id>.json` | per-task accumulated context (what was tried, last failure, operator guidance) |
| `evidence/` | check outputs (`proof-runs.jsonl`), tool-run index (`tool-runs.jsonl` + full `tool-outputs/`), turn failures (`turn-failures/`), full per-turn NDJSON transcripts (`turns/`), pre-run dirty snapshot (`baseline/`) — bulky dirs rotate oldest-first past `evidence_cap_mb` (default 500) |
| `ESCALATION.json` / `ESCALATION.md` | machine reason / human handoff, written when a run escalates |
| `runs/` | archived prior runs (written by `agent-driver reset`) |

## When a run escalates

`status: escalated`. **Read `ESCALATION.md` first** — it is the handoff: why the
run stopped, what each stuck task tried (with failure previews and evidence
paths), what it cost, and the literal next commands. `ESCALATION.json` carries
the machine-readable reason.

The loop the handoff points you through:

```bash
agent-driver logs --task <id>            # inspect the trail
agent-driver steer <id> "one-line answer to the blocker"
agent-driver resume                      # continues; stuck task's attempts reset
agent-driver resume --max-turns 40       # budget-breach escalations need the raise
agent-driver reset                       # or give up: archive under runs/, start fresh
```

You may also hand-edit `task-graph.json` (split a task, fix acceptance) before
`resume` — the graph is re-validated on resume and refuses helpfully if broken.

## Recovery

A crashed `agent-driver run` resumes by re-running `run`: state is written
atomically each turn, so the worst case is re-running one turn. On re-entry, an
in-progress task whose recorded working-tree fingerprint no longer matches is
reopened for re-verification (its stale next-step is cleared) rather than
trusted as done. Resuming reuses each task's captured `session_id` via
`--resume`. A paused run (Ctrl-C) continues with `agent-driver resume`.

## Interactive (no driver process)

With the hooks installed, an interactive Cursor session that stops mid-goal gets a `followup_message` from `agent-driver next` (computed by the same strategy code) nudging it toward the next task — bounded by the same turn budget.

## Uninstall

```bash
npm run uninstall:global   # remove hooks + ~/.cursor/agent-driver
```
