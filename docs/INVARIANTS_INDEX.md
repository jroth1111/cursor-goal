# Invariants index

Canonical list: [INVARIANTS.json](../INVARIANTS.json). Test status: [CAPABILITY.md](../CAPABILITY.md).

## Reserved / gaps

These IDs are intentionally unused in the registry (do not recycle without documenting):

I12, I25, I27, I28, I45, I50, I55, I59, I60, I71

## New operator surfaces (I78–I86, I94–I96)

| ID | Summary |
|----|---------|
| I78 | `cursor-goal explain` / dry-run pipeline diagnostics (includes last `stop-trace.jsonl` entry) |
| I79 | `cursor-goal goal lint` |
| I80 | `triage-log.jsonl` + `cursor-goal mode why` |
| I81 | Supervisor/runtime unit prompt parity (includes `deliverable.md` when `verified_by`) |
| I82–I84 | Adversarial deliverable + VERDICT RELEASE gate |
| I85 | `cursor-goal dispatch --verify` |
| I86 | `CURSOR_GOAL_STRICT` (runtime hook + core bash `beforeSubmitPrompt`) |
| I94 | `cursor-goal init --interactive` |
| I95 | `cursor-goal dispatch --verify --spawn` (fail-fast without agent; `--dry-run` for CI) |
| I96 | `core/install.sh --local-hooks` flag parsing |
