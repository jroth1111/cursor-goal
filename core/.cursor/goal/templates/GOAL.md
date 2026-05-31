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

### auth-middleware

Add auth middleware

- scope: `src/auth/`
- acceptance: `npm test -- src/auth`

## Checks

Machine-verified stopping condition. Each line is a shell command that must exit 0:

- `npm test`
- `npm run lint`

## Forbidden proxies

Do not treat these as done without the checks above:

- Tests pass but acceptance scenario untested
- Plan written but not implemented
- Agent narrative without fresh command output in PROGRESS.md
