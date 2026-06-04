import { readStdinJson } from "../lib/stdin.js";
import { hookJson, runStopVerifier } from "../lib/verify.js";
import { formatCursorQueuedFollowup } from "../lib/followup-steering.js";
import { appendStopTrace } from "../lib/stop-trace.js";
import { projectRoot } from "../lib/paths.js";
import { shouldQueueStopFollowup } from "../lib/governance-config.js";
import type { StopInput } from "../verifier/index.js";

let input: StopInput | undefined;
try {
  input = await readStdinJson<StopInput>();
  const root = projectRoot();
  const result = await runStopVerifier(input);
  const canQueueFollowup =
    input.status === "completed" && (await shouldQueueStopFollowup(root));
  if (input.status && input.status !== "completed") {
    await appendStopTrace(root, {
      at: new Date().toISOString(),
      level_failed: null,
      failures: [],
      pipeline_result: result.kind,
      terminal_status: input.status,
    }).catch(() => undefined);
  }

  switch (result.kind) {
    case "idle":
    case "release":
      hookJson({});
      break;
    case "disposition":
    case "continue":
      hookJson(canQueueFollowup ? { followup_message: formatCursorQueuedFollowup(result.message) } : {});
      break;
  }
} catch (e) {
  // The stop hook must never crash: a non-zero exit here is opaque to the
  // agent. Surface the error as a followup so work continues (and no false
  // RELEASE is emitted) instead of throwing out of the hook process.
  const msg = e instanceof Error ? e.message : String(e);
  hookJson(
    (!input || input.status === "completed") &&
      (await shouldQueueStopFollowup(projectRoot()).catch(() => false))
      ? {
          followup_message: formatCursorQueuedFollowup(
            `cursor-goal stop verifier error: ${msg}. Continuing - fix the verifier or GOAL state and re-run.`,
          ),
        }
      : {},
  );
}
