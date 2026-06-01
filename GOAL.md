# Goal

## Goal

Evolve cursor-goal so governed Cursor sessions enforce proof-first delivery: hooks, runtime verifier, install paths, and invariant tests stay aligned with `INVARIANTS.json` and `CAPABILITY.md`.

## Non-goals

- Shipping features without a failing invariant test first
- Broad refactors outside the scope paths below
- Editing a user's global `~/.cursor` install except via documented install scripts

## Scope

Paths the agent may change (one per line):

- `packages/cursor-goal-runtime/`
- `core/`
- `scripts/`
- `supervisor/`
- `docs/`
- `INVARIANTS.json`
- `CAPABILITY.md`

## Checks

Machine-verified stopping condition. Each line is a shell command that must exit 0:

- `npm test`
- `npm run check`

## Forbidden proxies

Do not treat these as done without the checks above:

- Tests pass but `CAPABILITY.md` still marks the invariant untested
- Hook or runtime behavior changed with no invariant under `packages/cursor-goal-runtime/tests/invariants/`
- Agent narrative without fresh `npm test` / `npm run check` output
