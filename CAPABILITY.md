# cursor-goal capability matrix

Only claim what invariant tests prove.

| Invariant | Description | Core | Runtime | Supervisor | Test | Status |
|-----------|-------------|------|---------|------------|------|--------|
| I01 | Empty checks no RELEASE | yes | yes | — | i01-empty-checks | tested |
| I02 | DISCOVERY Write/Edit advisory | yes | yes | — | i02-discovery-writes | tested |
| I03 | Scope default not `.` | — | yes | — | i03-scope-default | tested |
| I04 | Fresh proof on passing checks | marker | yes | — | i04-fresh-proof | tested |
| I05 | Forbidden proxy | — | yes | — | i05-forbidden-proxy | tested |
| I06 | subagentStop no RELEASE | yes | yes | — | i06-subagent-no-release | tested |
| I07 | stop followup on fail | yes | yes | — | i07-stop-followup | tested |
| I08 | DISPOSITION on max(goal, cursor) budget | yes | yes | — | i08-disposition-budget | tested |
| I09 | Supervisor prompt argv | — | — | yes | i09-supervisor-prompt | tested |
| I10 | Minimal/runtime stop parity (incl. stuck loop_count) | yes | yes | — | core-runtime-parity | tested |
| I11 | Edit marker on Write/Edit | yes | yes | — | i11-edit-marker | tested |
| I13 | Schema-valid compile | — | yes | — | i13-schema-compile | tested |
| I14 | Work units from scope | — | yes | — | i14-work-units-required | tested |
| I15 | Discovery before implement is advisory for writes | — | yes | — | i15-discovery-before-implement | tested |
| I16 | Subagent goal write deny | — | yes | — | i16-subagent-goal-write | tested |
| I17 | Parent units done for RELEASE | — | yes | — | i17-parent-units-done | tested |
| I18 | One subagent per unit | — | yes | — | i18-one-subagent-per-unit | tested |
| I19 | Compile gate on stale GOAL | — | yes | — | i19-compile-gate | tested |
| I20 | Unit acceptance auto-done | — | yes | — | i20-unit-acceptance-done | tested |
| I21 | Missing trajectory blocks RELEASE | — | yes | — | i21-missing-trajectory | tested |
| I22 | Parent WriteGate advisory at preToolUse | — | yes | — | i22-parent-write-gate | tested |
| I23 | Normal shell allowed; destructive shell denied | — | yes | — | i23-shell-patterns | tested |
| I24 | Subagent unit scope WriteGate | — | yes | — | i24-subagent-unit-scope | tested |
| I26 | Prioritized next action in stop followup | — | yes | — | i26-prioritized-next-action | tested |
| I29 | Goal loop counter increments (not Cursor index) | — | yes | — | i29-persisted-loop-count | tested |
| I52 | Stuck cursor loop_count: monotonic GOAL loop display | — | yes | — | i52-goal-loop-count-display | tested |
| I53 | INTAKE/DISCOVERY allow primary writes; compile → DISCOVERY | yes | yes | — | i53-intake-write-block | tested |
| I54 | DISPOSITION at cursor budget; display shows goal loop 1/N | yes | yes | — | i54-disposition-display-split | tested |
| I30 | Auto-advance IMPLEMENT→VERIFY | — | yes | — | i30-auto-verify-phase | tested |
| I31 | Unit acceptance scoped (not GOAL checks) | — | yes | — | i31-unit-scoped-acceptance | tested |
| I32 | cursor-goal next operator command | — | yes | — | i32-cursor-goal-next | tested |
| I33 | runtime-state.json on blocked stop | — | yes | — | i33-runtime-state-handoff | tested |
| I34 | last_check_fail in runtime-state.json | — | yes | — | i34-check-fail-embedded | tested |
| I35 | Hooks do not inject Task prompts | — | yes | — | i35-no-hook-injection | tested |
| I36 | dispatch-queue.json at compile | — | yes | — | i36-dispatch-queue-compile | tested |
| I37 | Supervisor auto-dispatch open units | — | — | yes | i37-supervisor-auto-dispatch | tested |
| I38 | Runtime-missing hooks fail open with minimal safety fallback | yes | — | — | i38-runtime-required | tested |
| I39 | next_action ranks units above phase | — | yes | — | i39-next-action-ranking | tested |
| I40 | Secondary blockers in stop followup | — | yes | — | i40-secondary-blockers | tested |
| I41 | Stale-proof gate on tree drift | — | yes | — | i41-stale-proof | tested |
| I42 | Compile invalidates runtime-state | — | yes | — | i42-compile-invalidate | tested |
| I43 | Scope-based default unit acceptance | — | yes | — | i43-unit-acceptance-default | tested |
| I44 | cursor-goal next --json snapshot | — | yes | — | i44-next-json | tested |
| I46 | cursor-goal dispatch CLI | — | yes | — | i46-dispatch-cli | tested |
| I47 | sessionStart auto-init GOAL in git repo | yes | yes | — | i47-session-auto-init | tested |
| I48 | Global runtime resolution (~/.cursor/cursor-goal-runtime) | yes | — | — | i48-global-runtime-resolve | tested |
| I49 | install-global.sh dry-run manifest + hooks merge | yes | — | — | i49-install-global-dry-run | tested |
| I51 | Governance triage chat/nudge/governed on beforeSubmitPrompt | — | yes | — | i51-governance-triage | tested |
| I56 | Atomic repo blocked-stop counter (`goal-loop.json` + dir lock) | — | yes | — | i56-multi-agent-state | tested |
| I57 | `beforeSubmitPrompt` warns only the blocked conversation | — | yes | — | i56-multi-agent-state | tested |
| I58 | Disposition warning per agent; other conversations may submit | — | yes | — | i56-multi-agent-state | tested |
| I61 | Repo summary and compile invalidation include disposition submit-blocks | — | yes | — | i61-runtime-state-p2-fixes | tested |
| I62 | Per-agent handoff and operator snapshot reflect disposition submit-blocks | — | yes | — | i61-runtime-state-p2-fixes | tested |
| I63 | sessionStart compiles only stale/missing artifacts and preserves fresh runtime state | — | yes | — | i63-session-start-fresh-compile | tested |
| I64 | GOAL/repo alignment blocks npm-without-package and reports template placeholders | — | yes | — | i64-goal-alignment | tested |
| I65 | `cursor-goal units done` is help-safe and rejects missing/blocked evidence | — | yes | — | i65-units-cli-safety | tested |
| I66 | `cursor-goal next` blocks instead of redispatching latest blocked unit evidence | — | yes | — | i66-blocked-unit-next-action | tested |
| I67 | Hook permissiveness contract | yes | yes | — | i67-hook-permissive-contract | tested |
| I68 | Consolidated fail-open hook contract | yes | yes | — | i68-failopen-contract | tested |
| I69 | Minimal verifier lock hygiene | yes | — | — | i69-minimal-lock-hygiene | tested |
| I70 | Optional per-check timeout | — | yes | — | i70-check-timeout | tested |
| I72 | dispatch-queue head_index lock discipline | — | yes | — | i72-dispatch-queue-lock | tested |
| I73 | Stale lifecycle passports invalidated on compile | — | yes | — | i73-runtime-state-passport-invalidation | tested |
| I74 | Minimal RELEASE passport atomicity and JSON safety | yes | — | — | i74-minimal-release-passport-atomicity | tested |
| I75 | Same-agent blocked-stop loop atomicity | — | yes | — | i75-agent-loop-atomicity | tested |
| I76 | RELEASE/session terminal lifecycle consistency | yes | yes | — | i76-release-session-lifecycle | tested |
| I77 | Standalone package boundary and no legacy runtime aliases | yes | yes | — | i77-standalone-boundary | tested |
| I78 | cursor-goal explain reports failing L-level, checks, next action | — | yes | — | i78-explain-stop | tested |
| I79 | cursor-goal goal lint catches placeholder GOAL.md and alignment errors | — | yes | — | i79-goal-lint | tested |
| I80 | Prompt triage writes and reads triage-log.jsonl per conversation | — | yes | — | i80-triage-log | tested |
| I81 | Supervisor unit prompt matches runtime buildUnitTaskPrompt | — | yes | yes | i81-unit-prompt-parity | tested |
| I82 | verified_by units require deliverable.md before RELEASE | — | yes | — | i82-deliverable-required | tested |
| I83 | VERDICT parsing for adversarial verifier | — | yes | — | i83-verdict-parse | tested |
| I84 | RELEASE requires VERDICT PASS for verified_by units | — | yes | — | i84-adversarial-release-gate | tested |
| I85 | cursor-goal dispatch --verify CLI | — | yes | — | i85-dispatch-verify-cli | tested |
| I86 | CURSOR_GOAL_STRICT blocks governed prompts without runtime (runtime + core bash) | yes | yes | — | i86-strict-governance | tested |
| I94 | cursor-goal init --interactive writes non-placeholder GOAL.md | — | yes | — | i94-init-interactive | tested |
| I95 | cursor-goal dispatch --verify --spawn dry-run prints agent command | — | yes | — | i95-dispatch-verify-spawn | tested |
| I96 | core/install.sh parses --local-hooks without a target path | yes | — | — | i96-core-install-flags | tested |
| I97 | runChecks creates proof-runs evidence directory | — | yes | — | i97-run-checks-evidence-dir | tested |
| I98 | Compiled work unit ids are unique | — | yes | — | i98-unique-work-unit-ids | tested |
| I99 | Compile watch avoids nested goal-dir locks | — | yes | — | i99-compile-watch-lock | tested |
| I100 | Global uninstall preserves non-cursor-goal hook entries | yes | — | — | i100-uninstall-preserves-user-hooks | tested |
| I101 | Global uninstall rejects unknown arguments before mutation | yes | — | — | i101-uninstall-global-flags | tested |
| I102 | cursor-goal pause creates goal directory in fresh repositories | — | yes | — | i102-pause-fresh-repo | tested |
| I103 | cursor-goal phase direct-set rejects unknown phases | — | yes | — | i103-phase-direct-set-validation | tested |
| I104 | Stop trace appends create the goal directory before writing | — | yes | — | i104-stop-trace-path | tested |
| I105 | cursor-goal discovery complete reports actual phase transition result | — | yes | — | i105-discovery-cli-phase-output | tested |
| I106 | cursor-goal init rejects unknown flags before creating GOAL.md | — | yes | — | i106-init-strict-flags | tested |
| I107 | cursor-goal discovery complete rejects unknown flags before writing phase state | — | yes | — | i107-discovery-strict-flags | tested |
| I108 | cursor-goal compile rejects unknown flags before writing compiled artifacts | — | yes | — | i108-compile-strict-flags | tested |
| I109 | cursor-goal dispatch rejects missing values for value-bearing options | — | yes | — | i109-dispatch-strict-args | tested |
| I110 | State-mutating operator commands reject stray args before writing state | — | yes | — | i110-operator-mutator-strict-args | tested |
| I111 | cursor-goal phase rejects stray args before writing trajectory state | — | yes | — | i111-phase-strict-args | tested |
| I112 | cursor-goal units done rejects stray args before marking units done | — | yes | — | i112-units-strict-args | tested |
| I113 | cursor-goal init and compile reject stray positional args before writing state | — | yes | — | i113-init-compile-strict-positionals | tested |
| I114 | cursor-goal doctor rejects unsupported args before applying fixes | — | yes | — | i114-doctor-strict-args | tested |
| I115 | cursor-goal dispatch rejects unsupported args before writing verifier state | — | yes | — | i115-dispatch-unsupported-args | tested |
| I116 | cursor-goal verify rejects unsupported args before writing release state | — | yes | — | i116-verify-strict-args | tested |
| I117 | cursor-goal upgrade rejects unsupported args before invoking the installer | — | yes | — | i117-upgrade-strict-args | tested |
| I118 | Supervisor rejects unsupported flags before deriving launch options | — | — | yes | i118-supervisor-strict-args | tested |
| I119 | Supervisor rejects invalid wall-clock values before deriving timeout behavior | — | — | yes | i119-supervisor-wall-value | tested |
| I120 | Global install removes stale schema and template files before copying current artifacts | yes | — | — | i120-install-global-sync | tested |
| I121 | Global install removes stale cursor-goal hook entries and files while preserving user hooks | yes | — | — | i121-install-global-hook-sync | tested |
| I159 | Global install hook merges preserve non-hook top-level config fields | yes | — | — | i159-install-hook-metadata | tested |
| I122 | Capability verifier fails when a registered invariant is missing from CAPABILITY.md | — | yes | — | i122-capability-missing-row | tested |
| I123 | Root npm run check includes repository claim verifiers | — | yes | — | i123-root-check-claims | tested |
| I124 | Capability verifier rejects stale rows and mismatched test links | — | yes | — | i124-capability-test-link | tested |
| I125 | Capability matrix uses Supervisor layer columns instead of legacy Pi claims | — | yes | — | i125-capability-supervisor-column | tested |
| I126 | .gitignore covers generated, cache, virtualenv, editor, and local secret artifacts | — | yes | — | i126-gitignore-noise-dirs | tested |
| I127 | Capability Core, Runtime, and Supervisor layer claims match INVARIANTS.json | — | yes | — | i127-capability-layer-claims | tested |
| I128 | Read-only operator commands reject unsupported arguments before normal output | — | yes | — | i128-readonly-operator-strict-args | tested |
| I129 | Unknown top-level CLI commands fail while help usage remains successful | — | yes | — | i129-top-level-command-strictness | tested |
| I130 | Read-only subcommands reject stray arguments before normal output | — | yes | — | i130-subcommand-strict-args | tested |
| I131 | Conversation-scoped operator options are documented and rejected when ignored | — | yes | — | i131-conversation-option-usage | tested |
| I132 | Dispatch rejects mode-incompatible verification flags before normal output | — | yes | — | i132-dispatch-mode-arg-strictness | tested |
| I133 | Dispatch rejects conflicting mode combinations before ignoring selected flags | — | yes | — | i133-dispatch-mode-combination-strictness | tested |
| I134 | Dispatch validates every value option occurrence before executing selected actions | — | yes | — | i134-dispatch-value-option-occurrences | tested |
| I135 | Next rejects conflicting output modes before selecting one mode | — | yes | — | i135-next-output-mode-strictness | tested |
| I136 | Dispatch rejects conflicting run modes before selecting dry-run behavior | — | yes | — | i136-dispatch-run-mode-strictness | tested |
| I137 | Supervisor parses options only before the prompt boundary | — | — | yes | i137-supervisor-prompt-option-boundary | tested |
| I138 | Supervisor rejects missing prompt values before deriving launch options | — | — | yes | i138-supervisor-prompt-value | tested |
| I156 | Supervisor rejects conflicting unit and parent run modes before launch | — | — | yes | i156-supervisor-mode-conflicts | tested |
| I139 | Global install dry-run does not require built runtime artifacts | — | yes | — | i139-install-global-dry-run-runtime-optional | tested |
| I140 | Global install dry-run reports without running the runtime build | — | yes | — | i140-install-global-dry-run-no-build | tested |
| I141 | Global uninstall removes stale generated hook files while preserving user hooks | — | yes | — | i141-uninstall-stale-hook-files | tested |
| I142 | Global upgrade runs the installer from the install manifest source | — | yes | — | i142-upgrade-manifest-source | tested |
| I143 | Doctor validates global install manifest git_sha and source availability | — | yes | — | i143-doctor-current-manifest | tested |
| I144 | Core install honors CURSOR_HOME when detecting a global runtime | yes | — | — | i144-core-install-cursor-home | tested |
| I145 | Hooks reject invalid direct work_unit_id values before writing unit evidence paths | — | yes | — | i145-invalid-work-unit-id-path | tested |
| I146 | Subagent governance path checks normalize evidence paths before allowing writes | — | yes | — | i146-normalized-governance-path | tested |
| I147 | Subagent work unit scopes cannot authorize writes outside the project root | yes | yes | — | i147-subagent-outside-root | tested |
| I148 | Structured work_unit_id fields outrank free-form tool payload text | — | yes | — | i148-structured-work-unit-id | tested |
| I149 | Dispatch rejects duplicate single-value options before side effects | — | yes | — | i149-dispatch-duplicate-value-options | tested |
| I150 | Work unit parsing ignores template prose and commented examples | — | yes | — | i150-work-unit-markdown-noise | tested |
| I151 | Compile rejects explicit work unit ids that cannot satisfy artifact schemas | — | yes | — | i151-invalid-work-unit-id-compile | tested |
| I152 | Logs tail zero returns no stop-trace entries | — | yes | — | i152-logs-zero-tail | tested |
| I153 | Read-only operator commands reject duplicate conversation selectors | — | yes | — | i153-operator-duplicate-conversation | tested |
| I154 | Prompt triage honors explicit read-only opt-outs over delivery words | — | yes | — | i154-readonly-triage-optout | tested |
| I155 | Global uninstall flattens legacy nested hooks before removing goal entries | — | yes | — | i155-uninstall-flattens-hooks | tested |
| I87 | Content-addressed working tree fingerprint (excludes .cursor/goal/) | — | yes | — | i87-working-tree-fingerprint | tested |
| I157 | Dry-run stop pipeline simulates auto-advance without mutating trajectory | — | yes | — | i157-dry-run-auto-advance | tested |
| I158 | Scope dot-segment paths are normalized before verifier enforcement | — | yes | — | i158-scope-dot-segments | tested |
| I88 | Subagent status gate blocks failed/cancelled completion | yes | yes | — | i88-subagent-status-gate | tested |
| I89 | Strict unit evidence v1 schema by default | — | yes | — | i89-unit-evidence-schema | tested |
| I160 | Session-end hook reports local marker write failures without crashing | — | yes | — | i160-session-end-fail-open | tested |
| I161 | Subagent WriteGate denies when work-unit state is unreadable | yes | yes | — | i161-subagent-malformed-work-units | tested |
| I162 | Doctor --json --fix emits one parseable JSON document | — | yes | — | i162-doctor-json-fix | tested |
| I163 | Minimal subagent governance isolation does not require jq | yes | — | — | i163-minimal-subagent-no-jq | tested |
| I164 | Compile rebuilds malformed generated work-unit artifacts | — | yes | — | i164-compile-recovers-work-units | tested |
| I165 | Supervisor interactive mode launches cursor-agent | — | — | yes | i165-supervisor-interactive-launch | tested |
| I166 | Compile rebuilds malformed generated manifest and trajectory artifacts | — | yes | — | i166-compile-recovers-generated-state | tested |
| I167 | Stop-time check execution blocks destructive shell commands before side effects | yes | yes | — | i167-destructive-stop-checks | tested |
| I168 | Default chat mode suppresses GOAL-governed prompt triage unless the conversation is blocked | — | yes | — | i168-default-chat-mode | tested |
| I169 | subagentStop returns fail-open JSON when generated work-unit state is malformed | — | yes | — | i169-subagent-stop-malformed-work-units | tested |
| I90 | cursor-goal init seeds GOAL without compiling by default | — | yes | — | i90-init-no-compile | tested |
| I91 | cursor-goal init --detect writes project-native checks | — | yes | — | i91-init-detect | tested |
| I92 | Default unit acceptance requires evidence file not path existence | — | yes | — | i92-acceptance-defaults | tested |
| I93 | Proof-plan shell policy emits advisory warnings only | — | yes | — | i93-proof-plan-advisory | tested |

## Multi-agent runtime state (one repo, many parent conversations)

| Scope | Path | Contents |
|-------|------|----------|
| Repo | `.cursor/goal/goal-loop.json` | `total_blocked_stops`, `loop_limit` (locked increments) |
| Repo summary | `.cursor/goal/runtime-state.json` | `phase`, totals, `blocked_agent_count` (submit-blocked agents: handoff and/or disposition) |
| Per conversation | `.cursor/goal/agents/<agentId>/runtime-state.json` | `blocked`, `loop_count`, `next_action`, `last_check_fail` (reads merge disposition via `readAgentHandoffState`) |
| Repo-wide pause | `.cursor/goal/PAUSED` | Idles stop verification; prompt hooks warn but continue |

Agent id: sanitized `conversation_id` from hook stdin, else `CURSOR_CONVERSATION_ID`, else `default`. `PAUSED`, RELEASE passports, checks, and work units remain repo-wide. Work-unit writes use the same goal-dir lock as `goal-loop.json`. Disposition is per agent: `.cursor/goal/agents/<id>/DISPOSITION.json` (repo `passports/DISPOSITION.json` is a manifest only). Blocked stops use one lock (`recordBlockedStop`) for both repo and per-agent increments. RELEASE prepares the terminal passport before reset, then clears blocked handoff, clears the releasing agent disposition, removes stale `SESSION_END`, and commits the release passport under the same lock. Compile invalidation runs under the same lock: clears stale `RELEASE`/`SESSION_END` lifecycle passports, clears agent blocked handoff, resets `goal-loop.json`, rebuilds repo summary, and preserves disposition files. Session end without release writes `passports/SESSION_END.json` (not disposition). `dispositionWaivesUnits` reads per-agent `waive_work_units`. Primary-agent Shell/Write/Task hooks are fail-open/advisory; only destructive shell and subagent governance writes hard-deny (I67).

## Verifier levels (runtime stop pipeline)

| Level | Responsibility | Tested via |
|-------|----------------|------------|
| L0 | Respect PAUSED | I07/I08 |
| L1 | GOAL.md exists | I01 |
| L2 | Checks present | I01 |
| L3 | Checks pass | I07 |
| L4 | Scope enforcement | I03/I05 |
| L5 | Forbidden proxy | I05 |
| L6 | Fresh proof sync + stale-proof gate | I04/I41 |
| L7 | Loop budget / DISPOSITION | I08 |
| L8 | Release passports | I01/I76 |
| — | Work units gate | I17 |
| — | Trajectory phase | I15/I21 |
| — | Invalidators / deliverable | I05 |
| — | Stop followup / runtime-state | I07/I17/I21/I26/I33/I39/I40 |

## Effective loop

1. `bash core/install.sh` and `npm run build` (recommended; missing runtime uses fail-open minimal safety fallback — I38)
2. `cursor-goal init && cursor-goal compile` — re-run after GOAL edits (I19/I42); emits `dispatch-queue.json` (I36)
3. `cursor-goal discovery complete "notes"` — advances to IMPLEMENT
4. Open units: `cursor-goal dispatch --run` or `node supervisor/run-goal.mjs` (I37/I46); in-IDE: `cursor-goal dispatch`
5. `subagentStop` runs unit acceptance (scope-based default — I43; explicit `acceptance:` override — I31)
6. Stop followup via `runtime-state.json` with ranked next action (I39) and secondary blockers (I40)
7. Hooks advise primary agents and enforce only narrow safety/isolation gates (I67); steer via stop, `cursor-goal next [--json]` (I44), dispatch CLI
8. Stale-proof blocks release on tree drift during verify (I41)

If the runtime is missing, hooks use the minimal safety fallback automatically.

## Proven vs not proven (CI)

| Claim | Evidence |
|-------|----------|
| Hook-direct stop IPC + `followup_message` | I07, T10, T21 |
| Goal blocked counter when `loop_count` stuck (e.g. 25) | I52, I29, I10 parity, T21 |
| Budget vs display split (e.g. cursor 38/40 → DISPOSITION, show goal 1/40) | I54 |
| Minimal bash persists goal loop in `runtime-state.json` | I10 stuck case, T21 |
| Parallel parent agents: per-conversation block + locked repo stop total | I56–I58 |
| Live `cursor-agent-goal` fires stop hooks | T22 (optional; `E2E_AGENT_TESTS`; nightly [e2e-scheduled.yml](.github/workflows/e2e-scheduled.yml)) |
| Full IDE session loop scheduling / exact Cursor `loop_count` semantics | Not proven in default CI |
