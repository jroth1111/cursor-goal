# cursor-goal supervisor (optional)

**Not used by hooks.** Run manually for wall-clock bounded sessions.

See [RUNBOOK.md](../RUNBOOK.md) for the full operator guide.

## Blessed loop

1. **Initialize** — `cursor-goal init` or `cursor-goal init --detect` (use `init --interactive` for a guided GOAL.md)
2. **Edit & compile** — edit `GOAL.md`, then `cursor-goal compile`
3. **Execute** — either:
   - `node supervisor/run-goal.mjs --prompt "…"` (parent + unit dispatch), or
   - `cursor-goal dispatch --run` (units only via supervisor subprocess)
4. **Adversarial verification** (when `verified_by` is set) — producer writes `.cursor/goal/outputs/<unit-id>/deliverable.md`, then:
   - `cursor-goal dispatch --verify` (print read-only prompt), or
   - `cursor-goal dispatch --verify --spawn` (run `cursor-agent`; fails if agent missing)
   - `cursor-goal dispatch --record-response <id> --from <file>` (record VERDICT manually)
5. **Diagnose** — stop hook, `cursor-goal explain`, `cursor-goal logs [N]`
6. **Finish** — RELEASE or DISPOSITION under `.cursor/goal/`

## Quick start

```bash
node supervisor/run-goal.mjs --prompt "Migrate auth per GOAL.md" --wall-min=180
```

Requires `core/` installed in the repo. Uses `@cursor-goal/runtime` when `dist/hook-stop.mjs` exists.

## Flags

| Flag | Purpose |
|------|---------|
| `--dry-run` | Print plan / agent argv only |
| `--wall-min=N` | Touch `PAUSED` after N minutes (default 120) |
| `--dispatch-units` | Dispatch open work units before parent |
| `--units-only` | Dispatch units and exit (same as `cursor-goal dispatch --run`) |
| `--interactive` | Parent TTY session (no `--print` batch) |

## Environment

| Variable | Purpose |
|----------|---------|
| `CURSOR_AGENT_BIN` | Path to `cursor-agent` (default: `cursor-agent` on PATH) |
| `CURSOR_GOAL_RUNTIME` | Override runtime package root |
| `CURSOR_GOAL_STRICT` | `1` blocks governed `beforeSubmitPrompt` when runtime is missing (hooks + core bash) |
| `CURSOR_PROJECT_DIR` | Repo root (set automatically in Cursor) |

Set `CURSOR_AGENT_BIN` if `cursor-agent` is not on PATH.
