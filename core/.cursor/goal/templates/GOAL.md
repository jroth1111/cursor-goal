# Goal

## Goal

Describe the user-visible outcome in one paragraph.

## Non-goals

- Item the agent must not do

## Scope

Paths the agent may change (one per line):

- `src/`

## Work units

Optional. When omitted, one unit is created per Scope path.

<!--
Example unit (uncomment and edit):

### example-unit
Short title

- scope: `src/example/`
- acceptance: `npm test -- src/example`
- verified_by: verifier
- verify_prompt: Re-run tests and spot-check the user-facing path
-->

## Checks

Machine-verified stopping condition. Each line is a shell command that must exit 0:

- `true`

<!--
Examples for your stack (replace `true` above):

- `npm test`
- `npm run lint`
- `uv run pytest`
-->

## Forbidden proxies

Do not treat these as done without the checks above:

- Tests pass but acceptance scenario untested
- Plan written but not implemented
- Agent narrative without fresh command output in PROGRESS.md
