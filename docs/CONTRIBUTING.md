# Contributing to cursor-goal

## Proof-first workflow

1. Read [AGENTS.md](../AGENTS.md).
2. Add a failing test under `packages/driver/test/`. The deterministic fake cursor-agent stub (`test/fake-agent/`, bound via `CURSOR_AGENT_BIN`) lets you exercise the full loop without an LLM.
3. Implement the smallest change to pass.
4. Run the checks:
   ```bash
   npm test       # builds the driver, runs the suite
   npm run check  # tsc --noEmit
   ```
5. Keep `README.md` and `docs/ARCHITECTURE.md` honest about what exists.

## Tests

- Unit (`test/unit.test.ts`): JSON extraction, shell policy, schema validation, oscillation.
- Loop (`test/loop.test.ts`): happy path, agent-error → escalate, budget exhaustion, oscillation → switch, non-objective verdict, two-turn resume, malformed-verdict fallback.
- Recovery (`test/recover.test.ts`), safety-net hook (`test/safety-net.test.ts`).

## Docs

Update `docs/ARCHITECTURE.md` and `docs/THREAT_MODEL.md` when behavior or controls change.
