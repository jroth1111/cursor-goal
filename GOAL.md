# Goal

## Goal

agent-driver drives cursor-agent on long-horizon tasks: decompose a goal into a task graph, spawn headless cursor-agent turns, verify each with acceptance checks, and continue via `--resume` until the goal's acceptance checks pass. Keep the driver, the safety-net hooks, and the install paths coherent, typed, and tested.

## Non-goals

- Re-introducing a passive stop-gate verifier with no forward driver
- Editing a user's global `~/.cursor` install except via the documented install scripts

## Scope

Paths the agent may change (one per line):

- `packages/driver/`
- `core/`
- `scripts/`
- `docs/`

## Checks

Machine-verified stopping condition. Each line is a shell command that must exit 0:

- `npm test`
- `npm run check`

## Forbidden proxies

Do not treat these as done without the checks above:

- Driver behavior changed with no test under `packages/driver/test/`
- Agent narrative without fresh `npm test` / `npm run check` output
