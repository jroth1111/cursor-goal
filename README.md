# cursor-goal

**Long-horizon runs for `cursor-agent`.** `agent-driver` is a driver process that owns an outer loop — decompose a goal, spawn `cursor-agent` headless, run acceptance checks, get a verdict, and continue the same session via `--resume` — repeating until the goal's checks pass, a budget is exhausted, or it escalates to you. A thin 3-hook safety net rides along for destructive-command denial and evidence capture.

It does **not** patch Cursor. It drives the stock `cursor-agent` CLI and reads its headless `stream-json` output.

## Why a driver, not a verifier

The agent stopping early is the core failure of long-horizon work. cursor-agent's stop-hook auto-continuation only runs in the interactive UI, never in headless `--print`. So a passive stop-gate cannot keep a headless run going. `agent-driver` instead **owns continuation**: it captures the `session_id` from the stream and re-invokes `cursor-agent --resume` with a targeted next instruction each turn, feeding forward what was tried and why it failed.

## Quick start

```bash
npm install
npm run build
npm run install:global          # stage agent-driver + safety-net hook under ~/.cursor
npm run install:global -- --profile   # also write a PATH env file to source
agent-driver doctor
```

Then, in any git repo:

```bash
agent-driver run "Add a /health endpoint and a passing test for it"
agent-driver status            # task graph + progress (+ archived run count)
agent-driver logs --follow     # live-tail the run journal
agent-driver verify            # run the goal-level acceptance checks
agent-driver diff              # what the run changed vs its intake baseline
agent-driver report            # render RUN_REPORT.md — the auditable run summary
```

`run` streams live progress to stderr (`--quiet` to silence) and `--notify "cmd"`
pings you on done/escalated (JSON summary on stdin). Ctrl-C pauses gracefully —
the in-flight turn is killed, state persists, and `agent-driver resume` continues.

A `GOAL.md` with `## Goal` and `## Checks` (backticked shell commands) is the structured way to specify acceptance; a freeform prompt also works, in which case the planner proposes per-task acceptance (and goal-level checks). An optional `## Driver` section carries per-goal config (`model`, `brain_model`, `max_turns`, `review_rounds`, `task_attempts`, `notify_cmd`, `evidence_cap_mb`); CLI flags override it. `agent-driver lint` validates the file before a run (prose-as-shell checks, dead scope paths, duplicate sections).

## How a run works

1. **Intake** — read `GOAL.md` or wrap the prompt into a goal spec.
2. **Decompose** — a `--mode plan` cursor-agent call returns an ajv-validated task graph.
3. **Drive** — per task: build an instruction from accumulated context, spawn `cursor-agent --print` (capturing `session_id`), run the task's acceptance checks, and get a verdict (objective checks decide it when present; otherwise a short `--mode ask` call).
4. **Decide** — `task_done` · `continue` (same session, sharper instruction) · `replan` · `switch_approach` (fresh session) · `escalate`. An `error`/`aborted` turn never counts as done.
5. **Stop** — when all tasks are done and the goal-level checks pass. Budgets (turns, attempts, tokens, wall-clock), no-progress detection, and oscillation detection bound the run.

For a freeform prompt (no `GOAL.md` checks) the planner also proposes goal-level
checks — adopted only into emptiness, never overriding human checks, and dropped
loudly if unrunnable.

When a run **escalates**, `ESCALATION.md` is the human handoff: what was tried,
where the evidence lives, and the literal next commands. Answer the blocker with
`agent-driver steer <task-id> "one line of guidance"` (it leads the next
instruction), then `agent-driver resume`. `agent-driver reset` archives the run
under `runs/` and frees the repo for a new goal.

State persists under `.cursor/goal/driver/` (run + intake baseline, task graph,
journal, per-task context, evidence including full per-turn NDJSON transcripts
under `evidence/turns/`); a crashed run resumes from disk. After a cursor-agent
upgrade, `agent-driver doctor --probe` validates the stream contract with two
tiny real turns; mid-run contract drift is flagged as `CONTRACT-DRIFT`, never
mistaken for task failure.

## Per-repo install (no global)

```bash
bash core/install.sh            # installs the safety-net hook + GOAL.md template
```

The hook resolves the driver from a global install, local `node_modules`, or `packages/driver/dist`, and **fails open** if none is found.

## Commands

```bash
npm run build            # build the driver
npm test                 # build + run the deterministic test suite
npm run check            # typecheck
npm run install:global   # stage under ~/.cursor
npm run uninstall:global # remove from ~/.cursor
npm run package:dist     # zip a portable bundle under dist/ for another machine
```

## Distribution zip (another machine)

```bash
npm run package:dist
# → dist/agent-driver-0.1.0.zip

# on the target host:
unzip agent-driver-0.1.0.zip && cd agent-driver-0.1.0
bash install.sh --profile
source ~/.cursor/cursor-goal.env
agent-driver doctor

# optional per-repo hook:
bash install-repo.sh /path/to/project

# remove:
bash uninstall.sh
```

See `scripts/dist/README.md` in the bundle for details.

## Layout

| Path | Role |
|------|------|
| `packages/driver/` | the driver: loop, planner/verdict calls, agent runner, state, safety-net hook |
| `core/` | per-repo safety-net hook shim + `GOAL.md` template |
| `scripts/` | global install / uninstall |

See [`AGENTS.md`](AGENTS.md) for operating rules, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design, and [`docs/FAILURE_MODES.md`](docs/FAILURE_MODES.md) for how the driver mitigates common agent failure modes.
