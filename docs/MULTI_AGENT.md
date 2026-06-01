# Multi-agent orchestration (cursor-goal)

How parent agents and subagents should interact with cursor-goal governance.

## Subagent scope

- One work unit per subagent; include `work_unit_id` in the Task prompt (see [`SUBAGENT_PROMPT.md`](../core/.cursor/goal/templates/SUBAGENT_PROMPT.md)).
- Unit prompts from `cursor-goal dispatch` include **completion discipline**: one final summary, no nested review subagents, no repeated handoff blocks (I207).

## Parent agent responsibilities

- Own release authority: subagents must not write `RELEASE.json` or mark the goal complete.
- Merge subagent results before claiming branch review done.
- Do not launch many parallel subagents to scan large transcript or repo trees without a merge step and a single proof run.

## Anti-patterns (observed failures)

| Anti-pattern | Why it fails |
|--------------|--------------|
| Parallel subagents + “finish with HANDOFF” loop | Parent never accepts completion; hundreds of duplicate handoffs, no progress |
| Marking CAPABILITY `tested` before `npm test` | Matrix overstates proof (I203 / I210 guard) |
| Contradictory partial reviews without HEAD test | One chunk says “patch correct”, another finds P1 bugs |

## Useful commands

```bash
cursor-goal dispatch              # queue-head unit prompt
cursor-goal status --json         # blocked + blocked_sources
cursor-goal doctor --json         # hooks, runtime, agent preflight
```

Governed stop followups for real blocks are prefixed with **`[governance]`** (I209) so they are distinguishable from advisory-only messages.
