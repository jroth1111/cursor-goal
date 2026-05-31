# Invariants index

Canonical list: [INVARIANTS.json](../INVARIANTS.json). Test status: [CAPABILITY.md](../CAPABILITY.md).

## Reserved / gaps

These IDs are intentionally unused in the registry (do not recycle without documenting):

I12, I25, I27, I28, I45, I50, I55, I59, I60, I71

## New operator surfaces (I78–I86, I94–I121)

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
| I97 | `runChecks` proof-runs evidence directory creation |
| I98 | Compile rejects duplicate work-unit ids |
| I99 | `cursor-goal compile --watch` avoids nested goal-dir locks |
| I100 | Global uninstall removes cursor-goal hooks without deleting user hooks |
| I101 | `scripts/uninstall-global.sh` rejects unknown arguments before mutation |
| I102 | `cursor-goal pause` creates `.cursor/goal/` before writing `PAUSED` |
| I103 | `cursor-goal phase <phase>` rejects unknown direct-set phase values |
| I104 | Stop trace appends create `.cursor/goal/` before writing diagnostics |
| I105 | `cursor-goal discovery complete` reports the actual phase transition result |
| I106 | `cursor-goal init` rejects unknown flags before creating `GOAL.md` |
| I107 | `cursor-goal discovery complete` rejects unknown flags before writing phase state |
| I108 | `cursor-goal compile` rejects unknown flags before writing compiled artifacts |
| I109 | `cursor-goal dispatch` rejects missing values for value-bearing options |
| I110 | State-mutating operator commands reject stray args before writing state |
| I111 | `cursor-goal phase` rejects stray args before writing trajectory state |
| I112 | `cursor-goal units done` rejects stray args before marking units done |
| I113 | `cursor-goal init` and `compile` reject stray positional args before writing state |
| I114 | `cursor-goal doctor` rejects unsupported args before applying fixes |
| I115 | `cursor-goal dispatch` rejects unsupported args before writing verifier state |
| I116 | `cursor-goal verify` rejects unsupported args before writing release state |
| I117 | `cursor-goal upgrade` rejects unsupported args before invoking the installer |
| I118 | Supervisor rejects unsupported flags before deriving launch options |
| I119 | Supervisor rejects invalid wall-clock values before deriving timeout behavior |
| I120 | Global install removes stale schema and template files before copying current artifacts |
| I121 | Global install removes stale cursor-goal hook entries and files while preserving user hooks |
| I122 | Capability verifier fails when a registered invariant is missing from CAPABILITY.md |
| I123 | Root npm run check includes repository claim verifiers |
| I124 | Capability verifier rejects stale rows and mismatched test links |
| I125 | Capability matrix uses Supervisor layer columns instead of legacy Pi claims |
| I126 | .gitignore covers generated, cache, virtualenv, editor, and local secret artifacts |
| I127 | Capability Core, Runtime, and Supervisor layer claims match INVARIANTS.json |
| I128 | Read-only operator commands reject unsupported arguments before normal output |
| I129 | Unknown top-level CLI commands fail while help usage remains successful |
