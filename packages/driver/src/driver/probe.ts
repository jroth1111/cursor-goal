import { runTurn } from "../agent/runner.js";
import type { AgentCall } from "./decompose.js";

export type ProbeCheck = { name: string; ok: boolean; detail: string };
export type ProbeResult = { ok: boolean; checks: ProbeCheck[] };

const PROBE_TIMEOUT_MS = 60 * 1000;

/**
 * The cheap canary for the reverse-engineered cursor-agent contract: one real
 * ask-mode turn through the actual runner (so the probe validates exactly the
 * code path the driver uses), then a --resume round-trip. Run it after every
 * cursor-agent upgrade — 30 seconds here beats 3 hours into a goal discovering
 * the stream shape moved. Costs a few hundred real tokens.
 */
export async function probeContract(root: string, call: AgentCall = runTurn): Promise<ProbeResult> {
  const checks: ProbeCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  let first;
  try {
    first = await call({
      instruction: "Reply with the single word: ok",
      mode: "ask",
      root,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch (e) {
    add("turn completes", false, e instanceof Error ? e.message : String(e));
    return { ok: false, checks };
  }

  add(
    "turn completes",
    first.terminal === "success",
    `terminal=${first.terminal} exit=${first.exitCode}${first.anomaly ? ` — ${first.anomaly.detail}` : ""}`,
  );
  add(
    "session_id captured",
    first.sessionId != null,
    first.sessionId ? `session ${first.sessionId}` : "no event carried a session_id",
  );
  add(
    "result event well-formed",
    first.terminal === "success" && !first.anomaly,
    first.anomaly ? first.anomaly.detail : "result event parsed",
  );
  add(
    "usage parsed",
    first.usage != null,
    first.usage ? `tokens in=${first.usage.input_tokens ?? "?"} out=${first.usage.output_tokens ?? "?"}` : "no usage on the result event",
  );

  if (first.sessionId) {
    try {
      const second = await call({
        instruction: "Reply with the single word: ok",
        mode: "ask",
        root,
        resume: first.sessionId,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      add(
        "--resume round-trips",
        second.terminal === "success" && second.sessionId === first.sessionId,
        second.sessionId === first.sessionId
          ? `same session ${second.sessionId}`
          : `expected session ${first.sessionId}, got ${second.sessionId ?? "none"} (terminal=${second.terminal})`,
      );
    } catch (e) {
      add("--resume round-trips", false, e instanceof Error ? e.message : String(e));
    }
  } else {
    add("--resume round-trips", false, "skipped: no session_id to resume");
  }

  return { ok: checks.every((c) => c.ok), checks };
}

export function formatProbe(result: ProbeResult): string {
  const lines = result.checks.map((c) => `  [${c.ok ? "PASS" : "FAIL"}] ${c.name} — ${c.detail}`);
  lines.push(result.ok ? "  contract probe: OK" : "  contract probe: FAILED — the cursor-agent stream contract may have changed");
  return `${lines.join("\n")}\n`;
}
