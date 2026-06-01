# cursor-goal — agent operating rules

Governed work on this tree **must** follow proof-first order. Do not scaffold and claim done.

## Mandatory workflow

1. Read [`INVARIANTS.json`](INVARIANTS.json).
2. Add or update the **failing test** for the invariant you are implementing (under `packages/cursor-goal-runtime/tests/invariants/`).
3. Implement the **smallest** gate change to make that test pass.
4. Run from the cursor-goal root:
   ```bash
   npm test
   npm run check
   ```
5. Update [`CAPABILITY.md`](CAPABILITY.md) — only mark `tested` when the linked invariant test passes in CI.
6. Root **`npm run check`** runs the full test suite before capability verification (I203). See [`docs/BRANCH_REVIEW.md`](docs/BRANCH_REVIEW.md) for branch review and multi-agent guidance.

## Forbidden patterns

- Creating hooks, packages, or README tables without a passing invariant test.
- Claiming "L0–L8 complete" or "full verifier" unless CAPABILITY.md shows each level tested.
- Bulk "fix all" without red tests first.
- Treating file layout as governance.

## Release authority

- **Core:** bash hooks + minimal stop verifier.
- **Runtime:** TypeScript L-pipeline.
- **Supervisor:** wall-clock wrapper only; never loaded by hooks.

## Success = tests, not narrative

A change is done when `INVARIANTS.json` entries have green tests and CAPABILITY.md matches reality.
