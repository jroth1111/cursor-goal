#!/usr/bin/env node
/**
 * Deterministic stand-in for `cursor-agent`, bound via CURSOR_AGENT_BIN. It emits
 * canned headless stream-json and performs scripted filesystem mutations so the
 * driver's real git-fingerprint / check primitives are exercised without an LLM.
 *
 * Scenario file (FAKE_AGENT_SCENARIO): JSON of shape
 *   { "plan": <taskGraph|null>, "verdicts": [<verdict>...],
 *     "turns": [ { match?, mode?, mutate?: [{file,content}|{rm}], delta?, result?, exitCode?, session?, chaos? } ] }
 * A simple cursor `--print` invocation is matched in order; `--mode plan|ask`
 * invocations are served from `plan` / `verdicts` queues.
 *
 * Chaos modes (turn.chaos = { mode, ... }) speak the pathological dialects the
 * driver must classify correctly. Mutations still apply first — a turn can both
 * edit files and then misbehave.
 *   crash-mid-stream  emit `afterLines` (default 2) NDJSON lines, then exit 1
 *                     with no result event (a mid-turn crash: plain error).
 *   garbage-lines     interleave non-JSON garbage with valid lines, then a valid
 *                     result (parser must skip garbage and still succeed).
 *   no-session-id     well-formed events but no session_id anywhere, exit 0.
 *   no-result-event   init + assistant only, exit 0 (the contract-drift signature).
 *   hang              emit init, then stay alive until killed (timeout/abort path).
 *   slow-drip         normal three-line output with `lineDelayMs` (default 30ms)
 *                     between lines (streaming robustness).
 * bad-schema is not a chaos mode: put a valid-JSON-wrong-schema object directly
 * into the verdicts/reviews/plan queues — consumers' retry/fallback paths see it.
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

function resultLine(text, sessionId, isError = false) {
  return {
    type: "result",
    subtype: isError ? "error" : "success",
    is_error: isError,
    result: text ?? "",
    session_id: sessionId,
    request_id: "req-fake",
    usage: { input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 },
  };
}

function emitResult(text, { sessionId, exitCode = 0, isError = false } = {}) {
  emit({ type: "system", subtype: "init", session_id: sessionId });
  emit({ type: "assistant", text: text ?? "", session_id: sessionId });
  emit(resultLine(text, sessionId, isError));
  process.exit(exitCode);
}

const state = loadState();

// ── read-only modes (decompose, replan, verdict all use --mode ask) ───────────
// Route by the PROMPT HEAD only (each driver brain has a fixed opening line).
// Routing on the whole prompt was a trap: verdict prompts embed agent output,
// acceptance text, and steering — uncontrolled strings where words like
// "stuck" or "subtask" silently rerouted a verdict request to the replan queue.
const head = prompt.split("\n").slice(0, 2).join("\n");
if (mode === "ask" || mode === "plan") {
  const isReview = /demanding staff engineer/i.test(head);
  if (isReview) {
    const reviews = scenario.reviews ?? [];
    const r = reviews[Math.min(state.review ?? 0, reviews.length - 1)] ?? { satisfied: true, findings: [] };
    state.review = (state.review ?? 0) + 1;
    saveState(state);
    emitResult(JSON.stringify(r), { sessionId: "review-sess" });
  }
  const isDecompose = /planning brain/i.test(head) && /Decompose the GOAL/i.test(head);
  const isReplan = /planning brain/i.test(head) && /task is stuck/i.test(head);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chaos = turn.chaos ?? null;
if (chaos) {
  const text = turn.delta ?? `did work (turn ${idx})`;
  switch (chaos.mode) {
    case "crash-mid-stream": {
      const lines = [
        { type: "system", subtype: "init", session_id: sessionId },
        { type: "assistant", text, session_id: sessionId },
        { type: "assistant", text: " …more", session_id: sessionId },
      ];
      const n = Math.max(1, Math.min(chaos.afterLines ?? 2, lines.length));
      for (const l of lines.slice(0, n)) emit(l);
      process.exit(1);
    }
    case "garbage-lines": {
      // result emitted directly: emitResult would prepend a SECOND init/assistant
      // pair and the fixture would not model the 'normal stream + noise' it claims
      emit({ type: "system", subtype: "init", session_id: sessionId });
      process.stdout.write("this is not json\n");
      process.stdout.write("{truncated json: \n");
      emit({ type: "assistant", text, session_id: sessionId });
      process.stdout.write("<<<binary-ish garbage>>>\n");
      emit(resultLine(text, sessionId));
      process.exit(0);
    }
    case "no-session-id": {
      emit({ type: "system", subtype: "init" });
      emit({ type: "assistant", text });
      emit({
        type: "result",
        subtype: "success",
        is_error: false,
        result: text,
        request_id: "req-fake",
        usage: { input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0 },
      });
      process.exit(0);
    }
    case "no-result-event": {
      emit({ type: "system", subtype: "init", session_id: sessionId });
      emit({ type: "assistant", text, session_id: sessionId });
      process.exit(0);
    }
    case "hang": {
      emit({ type: "system", subtype: "init", session_id: sessionId });
      setInterval(() => undefined, 1 << 30); // stay alive until killed
      break;
    }
    case "slow-drip": {
      // exactly the documented three lines, just slowly — emitResult would
      // duplicate init/assistant
      const delay = chaos.lineDelayMs ?? 30;
      emit({ type: "system", subtype: "init", session_id: sessionId });
      await sleep(delay);
      emit({ type: "assistant", text, session_id: sessionId });
      await sleep(delay);
      emit(resultLine(text, sessionId));
      process.exit(0);
    }
    default: {
      process.stderr.write(`fake-agent: unknown chaos mode ${chaos.mode}\n`);
      process.exit(3);
    }
  }
} else {
  emitResult(turn.delta ?? `did work (turn ${idx})`, { sessionId, exitCode, isError });
}
