import { readStdinJson } from "../lib/stdin.js";
import { hookJson, runStopVerifier } from "../lib/verify.js";
import type { StopInput } from "../verifier/index.js";

try {
  const input = await readStdinJson<StopInput>();
  const result = await runStopVerifier(input);

  switch (result.kind) {
    case "idle":
    case "release":
      hookJson({});
      break;
    case "disposition":
    case "continue":
      hookJson({ followup_message: result.message });
      break;
  }
} catch (e) {
  // The stop hook must never crash: a non-zero exit here is opaque to the
  // agent. Surface the error as a followup so work continues (and no false
  // RELEASE is emitted) instead of throwing out of the hook process.
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({
    followup_message: `cursor-goal stop verifier error: ${msg}. Continuing - fix the verifier or GOAL state and re-run.`,
  });
}
