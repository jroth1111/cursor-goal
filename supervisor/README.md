# cursor-goal supervisor (optional)

**Not used by hooks.** Run manually for wall-clock bounded sessions.

```bash
node supervisor/run-goal.mjs --prompt "Migrate auth per GOAL.md" --wall-min=180
```

Requires `core/` installed in the repo. Uses `@cursor-goal/runtime` if `dist/hook-stop.mjs` exists.

Flags:

- `--dry-run` — print plan only
- `--wall-min=N` — touch `PAUSED` after N minutes (default 120)

Set `CURSOR_AGENT_BIN` if `cursor-agent` is not on PATH.
