# Contributing to cursor-goal

## Proof-first workflow

1. Read [INVARIANTS.json](../INVARIANTS.json) and [AGENTS.md](../AGENTS.md).
2. Add a **failing** test under `packages/cursor-goal-runtime/tests/invariants/`.
3. Implement the smallest change to pass.
4. Register the invariant in `INVARIANTS.json`.
5. Mark [CAPABILITY.md](../CAPABILITY.md) as `tested` only when CI passes.

```bash
npm run build
npm test
npm run check
node scripts/verify-capability.mjs
```

## Publishing runtime (optional)

The package `@cursor-goal/runtime` is private by default. To publish to npm, bump `packages/cursor-goal-runtime/package.json` version and run `npm publish` manually — no automatic publish in CI.

## Docs

Update `docs/ARCHITECTURE.md` and `CAPABILITY.md` when behavior or proven claims change.
