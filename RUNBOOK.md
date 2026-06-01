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

### After changing cursor-goal (dev → IDE)

From the [cursor-goal](.) repo root:

```bash
npm run sync:global          # build + install:global + verify-installed-parity
cursor-goal doctor           # warn if global install SHA ≠ repo HEAD
cursor-goal doctor --strict  # exit 1 when global runtime is stale
```

Restart Cursor if hooks do not reload after editing `hooks.json`.

**Tests with `cursor-goal.env` sourced:** `CURSOR_GOAL_RUNTIME` points at your global install and can make install-parity invariant tests fail locally. CI does not set it. From the repo root:

```bash
env -u CURSOR_GOAL_RUNTIME npm test && npm run check
```

**cursor-agent wrapper:** `cursor-agent-goal` sources `~/.cursor/cursor-goal.env` then runs `cursor-agent`.

**Governance triage (default `auto`):** Each prompt is classified in `beforeSubmitPrompt`:

| Mode | Behavior |
|------|----------|
| **chat** | Passthrough — no GOAL required (Q&A, exploration) |
| **nudge** | Passthrough + hint to run `cursor-goal init` (delivery/coverage detected) |
| **governed** | Full gates — GOAL, compile, scope, stop RELEASE |

Hard triggers (always governed): `/goal …` or `cursor-goal govern`, `runtime-state.json` blocked, `cursor-goal mode governed`, `default_mode: governed`, or (under `auto`) delivery-shaped prompts when `GOAL.md` has checks.

**Session pin vs stop checks**

| Session (`session-mode.json`) | `/goal` or `forceGoverned` triage | Blocked agent | Stop runs checks |
|------------------------------|-----------------------------------|---------------|------------------|
| `chat` | yes → escalates to `governed` | yes | yes when governed |
| `governed` | yes | yes | yes |

`/goal` and delivery escalation persist `session-mode.json` as `governed` (source `triage`) so follow-up prompts stay on the stop loop. Only `cursor-goal mode chat` clears the pin.

### Recovering from SESSION_END (ended without RELEASE)

If a governed session ends without writing `.cursor/goal/passports/RELEASE.json`, the runtime writes
`.cursor/goal/passports/SESSION_END.json` with diagnostics. Future prompts may re-enter governed mode so you
don’t lose the run context.

Use this recovery loop:

```bash
cursor-goal explain session-end
cursor-goal session-end clear --force
cursor-goal next
```

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
   cursor-goal doctor --json                   # hooks, runtime, cursor-agent preflight (I205)
   cursor-goal dispatch --verify --spawn       # run cursor-agent verifier (exit 1 if missing)
   cursor-goal dispatch --verify --spawn --dry-run  # print agent argv + prompt (I95)
   cursor-goal logs 20           # tail stop-trace.jsonl
   cursor-goal upgrade           # refresh global runtime install
   ```

Optional: set `CURSOR_GOAL_LEGACY_EVIDENCE=1` only when migrating old unit evidence files. Use `cursor-goal init` (seeds GOAL only), `cursor-goal init --interactive` (guided GOAL.md — I94; refuses overwrite unless `--force`; `--dry-run` prints preview — I206), or `cursor-goal init --detect` to add project-native checks; `init --compile` opts into immediate compile.

Mark CAPABILITY rows **`tested` only after `npm run check` passes** (includes full `npm test` — I203). Editing `CAPABILITY.md` / `INVARIANTS.json`: run tests first, then `CURSOR_GOAL_GOVERNANCE_OK=1` if `verify-governance-diff` warns (I210). See [`docs/BRANCH_REVIEW.md`](docs/BRANCH_REVIEW.md).

`CURSOR_GOAL_STRICT=1` blocks governed `beforeSubmitPrompt` when the runtime package is missing (runtime hook and core bash — I86). Subagents with `verified_by` must write `.cursor/goal/outputs/<unit-id>/deliverable.md` (prompt includes path — I81).

`governed_prompt_block` in `.cursor/goal/config.json` (or `CURSOR_GOAL_GOVERNED_PROMPT_BLOCK=1`) blocks governed prompts when `GOAL.md` is missing or compile is stale (I200). Default is warn-only.

`preCompact` hook injects a short goal snapshot when the agent is blocked (I198). Shell gates run on `beforeShellExecution` only; `preToolUse` uses a matcher (I197).

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

## Multi-phase orchestrator runs

For long orchestrator prompts (e.g. `/goal …` with a phased plan), use `.cursor/goal/orchestrator.json`:

```bash
cursor-goal orchestrator init --dir .cursor-audit/my-run
cursor-goal orchestrator start          # marker + governed session + GOAL check
cursor-goal orchestrator status
cursor-goal orchestrator finish         # validates MASTER_STATUS / FINAL_REPORT
```

Guard script (installed at `.cursor/goal/scripts/check-orchestrator-status.mjs`): exits 0 when the marker is absent; when active, requires `FINAL_REPORT.md` or all `required_done` phases `DONE` in `MASTER_STATUS.md` / `ORCHESTRATOR_STATUS.json`.

Operator triage: `cursor-goal triage tail` / `cursor-goal triage why` (alias of `cursor-goal mode why` with governance fields).

## Tiered stop checks

In `GOAL.md ## Checks`, prefix commands with `[fast]` or `[full]` (default tier: `full`):

```markdown
## Checks
- `[fast]` npm run lint
- `[full]` npm test
```

Blocked stops use the `fast` profile by default; RELEASE re-runs all tiers. Override with `CURSOR_GOAL_STOP_CHECK_PROFILE=fast|all`. When `npm test` is in checks, set `hooks.json` `stop.timeout` ≥ 600 seconds.

## Missing runtime fallback

If the runtime is missing or crashes, hooks use the fail-open minimal safety
fallback automatically. Destructive shell commands remain denied (I38). Minimal bash honors session `chat` unless `/goal` triage or blocked agent (parity with runtime).

## CI

From cursor-goal root: `npm test` and `npm run check`.
