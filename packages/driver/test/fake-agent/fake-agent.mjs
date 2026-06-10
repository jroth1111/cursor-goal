#!/usr/bin/env node
/**
 * Deterministic stand-in for `cursor-agent`, bound via CURSOR_AGENT_BIN. It emits
 * canned headless stream-json and performs scripted filesystem mutations so the
 * driver's real git-fingerprint / check primitives are exercised without an LLM.
 *
 * Scenario file (FAKE_AGENT_SCENARIO): JSON of shape
 *   { "plan": <taskGraph|null>, "verdicts": [<verdict>...],
 *     "turns": [ { match?, mode?, mutate?: [{file,content}|{rm}], delta?, result?, exitCode?, session? } ] }
 * A simple cursor `--print` invocation is matched in order; `--mode plan|ask`
 * invocations are served from `plan` / `verdicts` queues.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
function flagVal(name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const mode = flagVal("--mode"); // "plan" | "ask" | null(edit)
const prompt = argv[argv.length - 1] ?? "";
const resume = flagVal("--resume");
const cwd = process.cwd();

const scenarioPath = process.env.FAKE_AGENT_SCENARIO;
const statePath = process.env.FAKE_AGENT_STATE || path.join(cwd, ".cursor", "goal", "driver", ".fake-state.json");
const scenario = scenarioPath && existsSync(scenarioPath) ? JSON.parse(readFileSync(scenarioPath, "utf8")) : {};

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return { editTurn: 0, verdict: 0, plan: 0 };
  }
}
function saveState(s) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(s));
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function emitResult(text, { sessionId, exitCode = 0, isError = false } = {}) {
  emit({ type: "system", subtype: "init", session_id: sessionId });
  emit({ type: "assistant", text: text ?? "", session_id: sessionId });
  emit({
    type: "result",
    subtype: isError ? "error" : "success",
    is_error: isError,
    result: text ?? "",
    session_id: sessionId,
    request_id: "req-fake",
    usage: { input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 },
  });
  process.exit(exitCode);
}

const state = loadState();

// ── read-only modes (decompose, replan, verdict all use --mode ask) ───────────
// Route by prompt content, not mode: decompose and verdict both run in ask mode.
if (mode === "ask" || mode === "plan") {
  const isDecompose = /Decompose the GOAL|ordered task graph/i.test(prompt);
  const isReplan = /STUCK TASK|broken into smaller subtasks|stuck|subtask/i.test(prompt);
  if (isReplan && scenario.replan !== undefined) {
    state.plan = (state.plan ?? 0) + 1;
    saveState(state);
    emitResult(JSON.stringify(scenario.replan), { sessionId: "plan-sess" });
  }
  if (isDecompose || isReplan) {
    const payload = isReplan ? scenario.replan ?? null : scenario.plan ?? null;
    state.plan = (state.plan ?? 0) + 1;
    saveState(state);
    if (!payload) emitResult("no plan", { sessionId: "plan-sess", exitCode: 0 });
    emitResult(JSON.stringify(payload), { sessionId: "plan-sess" });
  }
  // otherwise it's a verdict request
  const verdicts = scenario.verdicts ?? [];
  const v = verdicts[Math.min(state.verdict, verdicts.length - 1)] ?? {
    task_complete: false,
    confidence: 0.2,
    blockers: [],
    next_action: { kind: "continue", instruction: "keep going" },
  };
  state.verdict = (state.verdict ?? 0) + 1;
  saveState(state);
  emitResult(JSON.stringify(v), { sessionId: "ask-sess" });
}

// ── edit-mode: scripted mutation + terminal ───────────────────────────────────
const turns = scenario.turns ?? [];
const idx = state.editTurn ?? 0;
const turn = turns[Math.min(idx, turns.length - 1)] ?? {};
state.editTurn = idx + 1;
saveState(state);

function applyMutations(muts) {
  for (const m of muts ?? []) {
    if (m.rm) {
      rmSync(path.join(cwd, m.rm), { force: true, recursive: true });
    } else if (m.file) {
      const fp = path.join(cwd, m.file);
      mkdirSync(path.dirname(fp), { recursive: true });
      writeFileSync(fp, m.content ?? "");
    } else if (m.append) {
      const fp = path.join(cwd, m.append);
      mkdirSync(path.dirname(fp), { recursive: true });
      appendFileSync(fp, m.content ?? "");
    }
  }
}

applyMutations(turn.mutate);

const sessionId = turn.session ?? resume ?? `edit-sess-${idx}`;
const exitCode = typeof turn.exitCode === "number" ? turn.exitCode : 0;
const isError = turn.result === "error" || exitCode !== 0;
if (turn.result === "aborted") {
  // emit no result line, nonzero-ish exit to simulate abort
  emit({ type: "system", subtype: "init", session_id: sessionId });
  process.exit(exitCode || 1);
}
emitResult(turn.delta ?? `did work (turn ${idx})`, { sessionId, exitCode, isError });
