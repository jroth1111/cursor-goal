# Branch review (cursor-goal repo)

Guidance for reviewing large cursor-goal branches without tooling stalls or false proof claims.

## Proof order

1. Run **`npm test && npm run check`** on **HEAD** once. Root `check` runs the full test suite before `verify-capability.mjs` (I203).
2. Only then mark new or updated invariants **`tested`** in [`CAPABILITY.md`](../CAPABILITY.md).
3. When editing `CAPABILITY.md` or [`INVARIANTS.json`](../INVARIANTS.json), set `CURSOR_GOAL_GOVERNANCE_OK=1` after a green test run, or expect a warning from `scripts/verify-governance-diff.mjs` (strict with `CURSOR_GOAL_STRICT=1`).

## Avoid review stalls

- Prefer **`find` / `rg` → short file list → targeted reads** over fanning out many parallel agent sub-sessions on wide searches.
- Do not use repeating **handoff ping-pong** as a completion protocol; require one final structured summary.
- If multiple partial reviews disagree, reconcile against **one** green `npm test && npm run check` on HEAD—not per-chunk opinions alone.

## Operator surfaces to exercise

- `cursor-goal doctor --json` before `dispatch --verify --spawn` (agent preflight — I205).
- `cursor-goal init --interactive --dry-run` before overwriting an existing `GOAL.md` (I206).
- `cursor-goal status --json` for `blocked_sources` when debugging blocks (I208).

See also [`MULTI_AGENT.md`](MULTI_AGENT.md) for parent/subagent orchestration.
