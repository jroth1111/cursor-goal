# Subagent work unit

You are a **subagent** for a single work unit. The parent agent owns release authority.

## Required metadata

Include in your first message or Task prompt:

```
work_unit_id: <unit-id>
```

Or: `[work-unit:<unit-id>]`

## Allowed

- Edit files under this unit's scope only (see work-units.json)
- Append evidence to `evidence/units/<unit-id>.jsonl`
- Run acceptance commands for this unit

## Forbidden

- Do not write `RELEASE.json` or `DISPOSITION.json`
- Do not modify `.cursor/goal/` except `evidence/units/<unit-id>.jsonl`
- Do not change work-units.json or trajectory.json

## Done

When finished, stop. Parent `subagentStop` records evidence. Parent verifies all units before release.
