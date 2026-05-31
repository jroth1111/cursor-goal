# cursor-goal core (required layer)

Self-contained hook pack for cursor-agent. **No npm install required** — `bash`, `jq`, and `git`.

## Install

```bash
bash cursor-goal/core/install.sh [TARGET_REPO_ROOT]
```

## Without the runtime package

- `stop` runs checks from `GOAL.md` ## Checks (I01, I07, I08)
- `beforeSubmitPrompt` requires `GOAL.md`
- `preToolUse` blocks Write/Edit in DISCOVERY (I02)
- `subagentStop` never issues RELEASE (I06)
- `postToolUse` records edit marker (I11)

## With the runtime package

Same hooks dispatch to the TypeScript verifier pipeline.

See [`../CAPABILITY.md`](../CAPABILITY.md) for tested invariants.
