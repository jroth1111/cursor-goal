# cursor-goal RUNBOOK

## Install (global — default)

```bash
npm run build
npm run install:global
# optional: append source line to ~/.zshrc
npm run install:global -- --profile
source ~/.cursor/cursor-goal.env
cursor-goal doctor
```

User hooks live in `~/.cursor/hooks.json` (paths like `hooks/goal-stop.sh`). Runtime: `~/.cursor/cursor-goal-runtime/`. Schemas: `~/.cursor/goal/schemas/`.

**cursor-agent wrapper:** `cursor-agent-goal` sources `~/.cursor/cursor-goal.env` then runs `cursor-agent`.

**Governance triage (default `auto`):** Each prompt is classified in `beforeSubmitPrompt`:

| Mode | Behavior |
|------|----------|
| **chat** | Passthrough — no GOAL required (Q&A, exploration) |
| **nudge** | Passthrough + hint to run `cursor-goal init` (delivery/coverage detected) |
| **governed** | Full gates — GOAL, compile, scope, stop RELEASE |

Hard triggers (always governed): `GOAL.md` with checks, `runtime-state.json` blocked, `cursor-goal mode governed`, or `default_mode: governed` in `.cursor/goal/config.json`.

```bash
cursor-goal mode              # show default + session mode
cursor-goal mode chat         # session: Q&A without GOAL gates
cursor-goal mode governed     # session: init GOAL + full governance
cursor-goal mode auto         # clear session override
cursor-goal mode set governed # persist default_mode in config.json
```

**Auto-init:** only when `default_mode` is `governed` (config or env). Under `auto`, run `cursor-goal init` or `cursor-goal mode governed` to start delivery. Opt out: `export CURSOR_GOAL_NO_AUTO_INIT=1`.

**Uninstall:** `npm run uninstall:global` (add `-- --purge-runtime` to remove staged runtime/schemas).

## Install (per-repo override)

```bash
bash core/install.sh --local-hooks
npm run build
cursor-goal init              # or: cursor-goal init --interactive
cursor-goal doctor
```

When global runtime exists, plain `install.sh` skips hook copy and only seeds templates + `GOAL.md`.

## Effective non-pi daily loop

1. Edit `GOAL.md` — hooks block prompts if compile is stale (I19); run `cursor-goal compile` after edits (invalidates `runtime-state.json`, I42).
2. `cursor-goal discovery complete "notes"` — advances to IMPLEMENT.
3. **Dispatch open work units:**
   ```bash
   cursor-goal dispatch          # print queue-head Task prompt (in-IDE)
   cursor-goal dispatch --run    # supervisor unit loop only
   node supervisor/run-goal.mjs   # units + parent integration
   ```
4. Subagent writes limited to unit scope (I24); `subagentStop` runs acceptance (default: scope path must exist, I43).
5. Stop hook returns ranked `followup_message` from `runtime-state.json` (I39/I40). Stale tree during verify blocks release (I41).
6. Operator commands:
   ```bash
   cursor-goal explain           # why blocked (L-level, checks, next action)
   cursor-goal next              # human-readable next action
   cursor-goal next --verbose    # same as explain (text)
   cursor-goal next --json       # machine-readable snapshot (I44)
   cursor-goal status [--json]
   cursor-goal verify
   cursor-goal goal lint
   cursor-goal dispatch --verify --unit <id>   # adversarial prompt (I85)
   cursor-goal dispatch --verify --spawn       # run cursor-agent verifier (exit 1 if missing)
   cursor-goal dispatch --verify --spawn --dry-run  # print agent argv + prompt (I95)
   cursor-goal logs 20           # tail stop-trace.jsonl
   cursor-goal upgrade           # refresh global runtime install
   ```

Optional: set `CURSOR_GOAL_LEGACY_EVIDENCE=1` only when migrating old unit evidence files. Use `cursor-goal init` (seeds GOAL only), `cursor-goal init --interactive` (guided GOAL.md — I94), or `cursor-goal init --detect` to add project-native checks; `init --compile` opts into immediate compile.

`CURSOR_GOAL_STRICT=1` blocks governed `beforeSubmitPrompt` when the runtime package is missing (runtime hook and core bash — I86). Subagents with `verified_by` must write `.cursor/goal/outputs/<unit-id>/deliverable.md` (prompt includes path — I81).

## Work units + subagents

- Explicit `## Work units` in GOAL.md, or auto-slice from `## Scope`.
- Default acceptance checks scope paths exist; override with `- acceptance: \`true\`` for smoke tests (I31).
- Task prompt: `cursor-goal dispatch` or `runtime-state.json` → `next_action.task_prompt`.

## Phases

```bash
cursor-goal discovery complete "notes"
cursor-goal phase advance IMPLEMENT
cursor-goal status
```

## Supervisor (Ring 3)

```bash
# Default: dispatch all open units (queue order), then parent integration
node supervisor/run-goal.mjs

# Units only (no parent pass)
node supervisor/run-goal.mjs --units-only

# Parent-only after units done
node supervisor/run-goal.mjs --parent-only
```

Equivalent CLI: `cursor-goal dispatch --run` (units only).

## Missing runtime fallback

If the runtime is missing or crashes, hooks use the fail-open minimal safety
fallback automatically. Destructive shell commands remain denied (I38).

## CI

From cursor-goal root: `npm test` and `npm run check`.
