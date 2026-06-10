# cursor-goal core — safety-net hooks

The thin hook layer for `agent-driver`. `bash`, `jq`, and `git`; no npm install for the per-repo hook itself.

## Install

```bash
bash core/install.sh [TARGET_REPO_ROOT]
```

Installs one shim, `.cursor/hooks/safety-net.sh`, and registers it for three events in `.cursor/hooks.json`, plus a `GOAL.md` template.

## What the hook does

One script, branching on `hook_event_name`:

- `preToolUse` — deny destructive shell commands (`rm -rf`, `git push --force`, `drop database`). Fires headless and interactive.
- `postToolUse` — append a ground-truth evidence row under `.cursor/goal/driver/evidence/`.
- `stop` — in an interactive session, call `agent-driver next` and return its `followup_message` to continue toward the goal. No-op headless.

The shim resolves the driver from a global install (`~/.cursor/agent-driver`), local `node_modules`, or `packages/driver/dist`, and **fails open** (`{}`) if none is found — it never bricks a session.

The heavy lifting lives in `agent-driver`; these hooks are a net, not a dependency.
