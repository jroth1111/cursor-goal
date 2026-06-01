import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveAgentId } from "../lib/runtime-state.js";
import { goalDir, passportsDir, projectRoot, writeJson } from "../lib/paths.js";
import { sessionEndMarkerPath } from "../lib/disposition.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import { gitTreeId } from "../lib/git-state.js";
import { readStopTraceTail } from "../lib/stop-trace.js";
import { cursorHome } from "../lib/template.js";
import { resolveRuntimeRoot } from "../lib/resolve-runtime.js";
import { hasGovernedContract } from "../lib/prompt-triage.js";

async function readLastJsonl<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null;
  try {
    const raw = await readFile(file, "utf8");
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines.reverse()) {
      try {
        return JSON.parse(line) as T;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function readInstallManifest(): Promise<{ git_sha?: string; source?: string; runtime?: string } | null> {
  const file = path.join(cursorHome(), "cursor-goal/install-manifest.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as { git_sha?: string; source?: string; runtime?: string };
  } catch {
    return null;
  }
}

function classifyNoRelease(
  lastStopTrace: { level_failed?: string | null; failures?: string[]; pipeline_result?: string } | null,
  lastCheck: { cmd?: string; ok?: boolean } | null,
): { failureClass: string; why: string } {
  if (lastCheck && lastCheck.ok === false) {
    return {
      failureClass: "checks_failed",
      why: `last check failed (${lastCheck.cmd ?? "unknown check"})`,
    };
  }
  if (lastStopTrace?.pipeline_result && lastStopTrace.pipeline_result !== "release") {
    const failed = lastStopTrace.level_failed ?? lastStopTrace.failures?.[0] ?? "unknown";
    return {
      failureClass: "stop_blocked",
      why: `last stop did not release (${failed})`,
    };
  }
  if (lastCheck && lastCheck.ok === true) {
    return {
      failureClass: "green_but_unreleased",
      why: "checks passed but RELEASE passport was not written",
    };
  }
  return {
    failureClass: "release_missing",
    why: "release passport missing",
  };
}

async function main(): Promise<void> {
  const root = projectRoot();
  const input = await readStdinJson<{ conversation_id?: string }>();
  const agentId = resolveAgentId(input);
  const release = path.join(passportsDir(root), "RELEASE.json");

  if (!existsSync(release)) {
    const install = await readInstallManifest();
    const lastStopTrace = (await readStopTraceTail(root, 1).catch(() => []))[0] ?? null;
    const lastCheck = await readLastJsonl<{
      at?: string;
      cmd?: string;
      ok?: boolean;
      tree?: string;
      output?: string;
    }>(path.join(goalDir(root), "evidence", "proof-runs.jsonl"));
    const noRelease = classifyNoRelease(lastStopTrace, lastCheck);
    const governedContract = await hasGovernedContract(root).catch(() => false);
    await writeJson(sessionEndMarkerPath(root), {
      status: "SESSION_END",
      reason: "session_end_without_release",
      failure_class: noRelease.failureClass,
      had_governed_contract: governedContract,
      agent_id: agentId,
      conversation_id: input.conversation_id,
      at: new Date().toISOString(),
      root,
      git_tree: gitTreeId(root),
      runtime_root: process.env.CURSOR_GOAL_RUNTIME ?? resolveRuntimeRoot(root),
      install_git_sha: install?.git_sha ?? null,
      install_source: install?.source ?? null,
      why_no_release: noRelease.why,
      last_stop_trace: lastStopTrace,
      last_check_result: lastCheck,
    });
  }

  hookJson({});
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({ agent_message: `sessionEnd warning: ${msg}; continuing fail-open` });
}
