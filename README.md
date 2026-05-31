# cursor-goal

Governed long-horizon runs for **cursor-agent** without patching Cursor. Proof-first: see [`INVARIANTS.json`](INVARIANTS.json), [`CAPABILITY.md`](CAPABILITY.md), and [`AGENTS.md`](AGENTS.md). Architecture and contributing: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

| Layer | Path | Required? | Role |
|-------|------|-----------|------|
| **Core** | `core/` | Yes (global or per-repo) | Hooks + bash verifier + `GOAL.md` templates — `jq`, `git` |
| **Runtime** | `packages/cursor-goal-runtime/` | Yes (governed runs) | TypeScript verifier pipeline, compile, CLI |
| **Supervisor** | `supervisor/` | No | Wall-clock spawn wrapper — manual only |

## Quick start (global — recommended)

From the standalone `cursor-goal` root:

```bash
npm run build
npm run install:global          # ~/.cursor hooks + runtime
npm run install:global -- --profile   # optional: source env in shell
cursor-goal doctor
```

Then open any git repo in Cursor or run `cursor-agent-goal`. Default triage is **auto** (Q&A passthrough; delivery prompts nudge `cursor-goal init`). Full governance: `cursor-goal mode governed` or set `.cursor/goal/config.json` to `{ "default_mode": "governed" }`.

## Quick start (per-repo only)

```bash
bash core/install.sh
$EDITOR GOAL.md
# Run cursor-agent; work toward GOAL.md until passports/RELEASE.json exists.
```

If global runtime is installed, `install.sh` skips local hooks unless you pass `--local-hooks`.

## With runtime package

```bash
npm install
npm run build
bash core/install.sh --local-hooks   # optional pinned hooks in repo
```

## With supervisor (optional)

```bash
node supervisor/run-goal.mjs --prompt "Work toward GOAL.md"
```

## Dispatch

Hooks source `_cgr-lib.sh` → runtime `dist/hook-*.mjs` if built, else bash fallback.

## Commands

```bash
npm run install:global
npm run uninstall:global
npm run install:repo
npm run build
npm test
npm run check
```

## What is tested

See [`CAPABILITY.md`](CAPABILITY.md) for invariant coverage. Do not assume features without a `tested` row.
