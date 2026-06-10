# cursor-goal — agent operating rules

This repo builds `agent-driver`, a long-horizon driver for `cursor-agent`. Work proof-first: a behavior change is done when it has a test and the checks are green.

## Mandatory workflow

1. Add or update a test under `packages/driver/test/` for the behavior you are changing.
2. Implement the smallest change to make it pass.
3. From the repo root:
   ```bash
   npm test       # builds the driver, runs the deterministic suite (fake cursor-agent stub)
   npm run check  # tsc --noEmit
   ```
4. Keep `README.md` and `docs/ARCHITECTURE.md` honest about what exists.

## Design invariants (do not regress)

- **The driver owns continuation.** Never depend on a stop-hook `followup_message` to keep a headless run going — it does not fire in `--print`. Re-invoke `cursor-agent --resume <session_id>`.
- **Checks beat self-claims.** An agent turn that ends in `error`/`aborted`, or whose acceptance checks fail, is never marked done — regardless of what the model says.
- **Objective when possible.** When a task has runnable acceptance checks and they pass, skip the LLM verdict.
- **State on disk is authoritative.** Persist atomically each turn so a crash resumes from `.cursor/goal/driver/`.
- **Hooks are a net, not a dependency.** The driver must function (own loop + own checks) even if hooks never fire.

## Forbidden patterns

- Adding driver behavior with no test.
- Trusting `--resume` to have retained context without re-injecting acceptance + last failure.
- Editing a user's global `~/.cursor` except via `scripts/install-global.sh` / `uninstall-global.sh`.

## Success = tests, not narrative

`npm test` green and the docs match reality.
