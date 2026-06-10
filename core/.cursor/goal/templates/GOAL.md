# Goal

## Goal

Describe the user-visible outcome in one paragraph. agent-driver decomposes this into tasks itself — you do not list tasks here.

## Non-goals

- Item the agent must not do

## Scope

Paths the work should stay within (one per line):

- `src/`

## Checks

Goal-level acceptance. Each line is a backticked shell command that must exit 0; the run is done when all pass:

- `true`

<!--
Replace `true` with checks for your stack, e.g.:

- `npm test`
- `npm run lint`
- `uv run pytest`
-->

## Forbidden proxies

Do not treat these as done without the checks above:

- Tests pass but the acceptance scenario is untested
- Plan written but not implemented
- Agent narrative without fresh command output
