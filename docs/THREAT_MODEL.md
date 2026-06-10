# agent-driver threat model

The driver runs `cursor-agent` with full tool access (`--force --trust`) to make autonomous progress. The controls below bound what that can do.

## Runaway / cost

Every run is bounded by budgets persisted in `run.json` and checked before each turn: global turn count, per-task attempts, token total (summed from stream `usage`), and wall-clock. A no-progress streak (working-tree fingerprint unchanged) and an oscillation ring (A→B→A) escalate instead of looping. Any breach stops the run and writes `ESCALATION.json`. `--max-turns` and `--dry-run` are available for safe experimentation.

## Destructive commands

The `preToolUse` safety-net hook denies destructive shell commands (`rm -rf`, `git push --force`, `drop database`) via `hooks/destructive-shell.json` — the headless-reliable interception point. The check runner refuses the same patterns as defense in depth. The hook **fails open**: if the driver isn't installed, it returns `{}` rather than bricking the session.

## Trusting the agent

The driver never trusts the agent's self-claim of completion. A task is done only when its acceptance checks pass (objective) or, absent checks, a read-only verdict accepts it with no contradicting evidence. A turn that ends in `error`/`aborted` is never marked done. `--resume` context is not assumed retained — acceptance and last-failure are re-injected each turn and verified against the real tree.

## Crash safety

State is written atomically each turn; the worst case is re-running one turn. On recovery, a task whose recorded tree no longer matches the real tree is reopened for re-verification rather than trusted. Edit turns can be isolated with cursor-agent's native `-w/--worktree`; the driver never auto-commits.

## Out of scope

- The driver does not patch Cursor or inject Task prompts; in interactive mode it only returns a `followup_message` the IDE may use.
- It does not edit a user's global `~/.cursor` except via the documented install scripts.
