import { spawn } from "node:child_process";
import { appendJournal } from "../lib/journal.js";
import type { RunState } from "../state/schema.js";

const NOTIFY_TIMEOUT_MS = 60 * 1000;

/**
 * Fire the operator's notify command when a run reaches a terminal state. The
 * whole point of an autonomous driver is not watching the terminal — this is the
 * ping that brings the human back at exactly the moments one is needed (review
 * the deliverable, or unblock an escalation).
 *
 * The command is operator-supplied config (same trust class as acceptance checks
 * from GOAL.md), runs with their privileges, gets a JSON summary on stdin and
 * AGENT_DRIVER_STATUS/AGENT_DRIVER_ROOT in env. Failures are journaled and NEVER
 * affect the run outcome; a hanging notifier is killed at the timeout.
 */
export async function notifyRunEnd(
  root: string,
  run: RunState,
  cmd: string | undefined,
  timeoutMs = NOTIFY_TIMEOUT_MS,
): Promise<void> {
  if (!cmd?.trim()) return;
  const payload = JSON.stringify({
    status: run.status,
    goal: run.goal_spec.goal_text,
    turns: run.global_turns,
    tokens: run.consumed.tokens,
    escalation_reason: run.escalation_reason,
    residual_findings: run.residual_findings.length,
    root,
  });

  const outcome = await new Promise<string>((resolve) => {
    let settled = false;
    const settle = (note: string) => {
      if (!settled) {
        settled = true;
        resolve(note);
      }
    };
    let child;
    try {
      child = spawn("/bin/bash", ["-c", cmd], {
        cwd: root,
        stdio: ["pipe", "ignore", "ignore"],
        env: { ...process.env, AGENT_DRIVER_STATUS: run.status, AGENT_DRIVER_ROOT: root },
      });
    } catch (e) {
      settle(`notify failed to spawn: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(`notify timed out after ${timeoutMs}ms and was killed`);
    }, timeoutMs);
    timer.unref();
    child.on("error", (e) => {
      clearTimeout(timer);
      settle(`notify failed: ${e.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle(code === 0 ? "notify ok" : `notify failed: exit ${code}`);
    });
    child.stdin.on("error", () => undefined); // notifier may not read stdin; that's fine
    child.stdin.write(payload);
    child.stdin.end();
  });

  await appendJournal(root, { at: new Date().toISOString(), kind: "lifecycle", note: `${outcome} (${cmd})` });
}
