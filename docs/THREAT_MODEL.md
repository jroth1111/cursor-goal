# cursor-goal threat model

## Default: fail-open primary hooks (I67, I68)

When the TypeScript runtime is missing or errors:

- Primary-agent **Write/Edit** and normal **Shell** are generally **allowed** (advisory messages only).
- **Stop** may use minimal bash verifier (narrow safety).
- Goal is to avoid bricking the IDE mid-session.

## Hard denies (always on when hooks run)

| Gate | Invariant |
|------|-----------|
| Destructive shell (`rm -rf`, `git push --force`, `drop database`) | I23 |
| Subagent writes outside unit scope | I24 |
| Subagent writes to `.cursor/goal` (except evidence paths) | I16 |
| Second subagent on same in-progress unit | I18 |

## Strict mode

Set `CURSOR_GOAL_STRICT=1` to **deny** governed `beforeSubmitPrompt` when runtime is not installed (I86). Use in CI or teams that require proof-first gates.

## Adversarial verification

`verified_by` units require `outputs/<unit>/deliverable.md` and a recorded `VERDICT: PASS` before RELEASE (I82–I84). This does not replace shell checks (L3).

## Out of scope

- cursor-goal does not patch Cursor or inject Task prompts (I35).
- Supervisor is manual; not loaded by hooks.
