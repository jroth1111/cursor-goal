#!/usr/bin/env node
/**
 * The thin safety net. One script, three events:
 *   - preToolUse:  deny destructive shell commands (fires headless AND interactive)
 *   - postToolUse: append a ground-truth evidence row (fires headless)
 *   - stop:        nudge with the driver's next action (interactive only; no-op headless)
 *
 * cursor-agent passes a JSON payload on stdin keyed by `hook_event_name` and
 * expects a JSON response on stdout. Confirmed against decompiled
 * agent-exec/dist/index.js:860-918 and hooks/dist/index.js.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { matchDestructiveRule } from "../lib/shell-allow.js";
import { evidenceDir, projectRoot } from "../lib/paths.js";
import {
  PREVIEW,
  progressiveReveal,
  toolOutputBasename,
  writeTextArtifact,
} from "../lib/progressive-reveal.js";
import { computeNext } from "../bridge/hook-next.js";

type HookPayload = {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  tool_use_id?: string;
  cwd?: string;
  duration?: number;
  loop_count?: number;
  session_id?: string;
};

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(buf));
  });
}

/** Collect every string leaf in a tool_input object (command lives under varying keys). */
function stringLeaves(value: unknown, acc: string[] = [], depth = 0): string[] {
  if (depth > 6) return acc;
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, acc, depth + 1);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) stringLeaves(v, acc, depth + 1);
  }
  return acc;
}

function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj ?? {}));
}

async function handlePreToolUse(p: HookPayload): Promise<void> {
  for (const s of stringLeaves(p.tool_input)) {
    const rule = matchDestructiveRule(s);
    if (rule) {
      emit({
        permission: "deny",
        agent_message: `Blocked by safety policy (${rule}). Use a non-destructive alternative.`,
        user_message: `agent-driver denied a destructive command (rule: ${rule}).`,
      });
      return;
    }
  }
  emit({ permission: "allow" });
}

function normalizeToolOutput(output: unknown): string | undefined {
  if (output == null) return undefined;
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

async function handlePostToolUse(p: HookPayload): Promise<void> {
  try {
    const root = projectRoot();
    const file = path.join(evidenceDir(root), "tool-runs.jsonl");
    await mkdir(path.dirname(file), { recursive: true });
    const full = normalizeToolOutput(p.tool_output);
    let outputArtifact: string | undefined;
    let outputTail: string | undefined;
    let truncated = false;
    let outputBytes = 0;
    if (full !== undefined) {
      outputBytes = Buffer.byteLength(full, "utf8");
      outputArtifact = await writeTextArtifact(root, "tool-outputs", toolOutputBasename(p.tool_use_id), full);
      const revealed = progressiveReveal(full, { maxChars: PREVIEW.TOOL_OUTPUT_TAIL, tail: true });
      outputTail = revealed.preview;
      truncated = revealed.truncated;
    }
    await appendFile(
      file,
      `${JSON.stringify({
        at: new Date().toISOString(),
        tool_name: p.tool_name,
        tool_use_id: p.tool_use_id,
        cwd: p.cwd,
        duration: p.duration,
        output_bytes: outputBytes || undefined,
        truncated: truncated || undefined,
        output_artifact: outputArtifact,
        output_tail: outputTail,
      })}\n`,
      "utf8",
    );
  } catch {
    /* evidence capture must never block the agent */
  }
  emit({});
}

async function handleStop(p: HookPayload): Promise<void> {
  try {
    const root = projectRoot();
    const result = await computeNext(root, p.loop_count ?? 0);
    emit(result);
  } catch {
    emit({}); // never wedge an interactive session on a governance error
  }
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: HookPayload = {};
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    emit({});
    return;
  }
  switch (payload.hook_event_name) {
    case "preToolUse":
      await handlePreToolUse(payload);
      break;
    case "postToolUse":
      await handlePostToolUse(payload);
      break;
    case "stop":
      await handleStop(payload);
      break;
    default:
      emit({});
  }
}

main().catch(() => emit({}));
