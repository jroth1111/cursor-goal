# cursor-goal architecture

## Layers

| Layer | Path | Role |
|-------|------|------|
| Core | `core/` | Bash hook dispatch, minimal stop verifier, templates |
| Runtime | `packages/cursor-goal-runtime/` | TypeScript L-pipeline, compile, CLI |
| Supervisor | `supervisor/` | Optional wall-clock `cursor-agent` wrapper (not hook-loaded) |

## Hook dispatch

```
Cursor → core/.cursor/hooks/goal-*.sh
       → _cgr-lib.sh resolves CURSOR_GOAL_RUNTIME
       → dist/hook-<event>.mjs (or bash fallback if missing — I38)
```

Events: `stop`, `sessionStart`, `beforeSubmitPrompt`, `preToolUse`, `beforeShellExecution`, `postToolUse`, `subagentStop`, `sessionEnd`.

## Compile artifacts

`cursor-goal compile` writes under `.cursor/goal/`:

- `manifest.json`, `checks.json`, `scope.json`, `work-units.json`, `dispatch-queue.json`
- `trajectory.json`, `discovery.json`, `proof-plan.json`

## Stop pipeline (runtime)

Ordered gates in `runStopPipeline` (dry-run supported for `cursor-goal explain`):

- L0 PAUSED, L1 contract, L2 checks present, L3 checks pass, L4 scope, L5 forbidden proxy
- L6 fresh proof, work units, trajectory, invalidators, **L-adversarial** (verified_by + VERDICT)
- L7 loop budget / DISPOSITION, L8 RELEASE passports

Blocked stops write `runtime-state.json`, `stop-trace.jsonl`, and optional `followup_message` to the agent.

## Multi-agent state

See [CAPABILITY.md](../CAPABILITY.md) — repo-wide `goal-loop.json` and per-conversation `agents/<id>/runtime-state.json`.
