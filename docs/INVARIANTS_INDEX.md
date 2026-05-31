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
| I130 | Read-only subcommands reject stray arguments before normal output |
| I131 | Conversation-scoped operator options are documented and rejected when ignored |
| I132 | Dispatch rejects mode-incompatible verification flags before normal output |
| I133 | Dispatch rejects conflicting mode combinations before ignoring selected flags |
| I134 | Dispatch validates every value option occurrence before executing selected actions |
| I135 | Next rejects conflicting output modes before selecting one mode |
| I136 | Dispatch rejects conflicting run modes before selecting dry-run behavior |
| I137 | Supervisor parses options only before the prompt boundary |
| I138 | Supervisor rejects missing prompt values before deriving launch options |
| I156 | Supervisor rejects conflicting unit and parent run modes before launch |
| I139 | Global install dry-run does not require built runtime artifacts |
| I140 | Global install dry-run reports without running the runtime build |
| I141 | Global uninstall removes stale generated hook files while preserving user hooks |
| I142 | Global upgrade runs the installer from the install manifest source |
| I143 | Doctor compares global install manifest git_sha with the source repo HEAD |
| I144 | Core install honors CURSOR_HOME when detecting a global runtime |
| I145 | Hooks reject invalid direct work_unit_id values before writing unit evidence paths |
| I146 | Subagent governance path checks normalize evidence paths before allowing writes |
| I147 | Subagent work unit scopes cannot authorize writes outside the project root |
| I148 | Structured work_unit_id fields outrank free-form tool payload text |
| I149 | Dispatch rejects duplicate single-value options before side effects |
| I150 | Work unit parsing ignores template prose and commented examples |
| I151 | Compile rejects explicit work unit ids that cannot satisfy artifact schemas |
| I152 | Logs tail zero returns no stop-trace entries |
| I153 | Read-only operator commands reject duplicate conversation selectors |
| I154 | Prompt triage honors explicit read-only opt-outs over delivery words |
| I155 | Global uninstall flattens legacy nested hooks before removing goal entries |
| I157 | Dry-run stop pipeline simulates auto-advance without mutating trajectory |
| I158 | Scope dot-segment paths are normalized before verifier enforcement |
