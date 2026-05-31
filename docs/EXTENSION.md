# cursor-goal IDE extension (spec)

Future optional package (not required for governance):

## Status bar

- Read `.cursor/goal/runtime-state.json` and `goal-loop.json`
- Show: phase, repo blocked stops, this conversation blocked/disposition
- Click → run `cursor-goal next --json` and show headline

## Commands

- `cursor-goal.explain` — shell out to CLI
- `cursor-goal.compile` — compile GOAL.md

## Non-goals

- Do not duplicate hook logic in the extension; hooks remain source of truth for enforcement.
