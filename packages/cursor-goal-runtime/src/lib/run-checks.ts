import { execSync } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "./paths.js";
import { gitTreeId } from "./git-state.js";
import { shellCommandAllowed } from "./shell-allow.js";

export type CheckResult = { cmd: string; ok: boolean; tree: string; output?: string };

export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

function captureExecError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const text = [e.stderr, e.stdout, e.message].filter(Boolean).join("\n");
    if (text) return text.slice(0, 4000);
  }
  return String(err).slice(0, 4000);
}

export function checkTimeoutMs(): number {
  const raw = process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;
  if (raw === "0") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHECK_TIMEOUT_MS;
}

export async function runChecks(root: string, commands: string[]): Promise<CheckResult[]> {
  const tree = gitTreeId(root);
  const timeoutMs = checkTimeoutMs();
  const results: CheckResult[] = [];
  const proofRunsPath = path.join(goalDir(root), "evidence", "proof-runs.jsonl");
  await mkdir(path.dirname(proofRunsPath), { recursive: true });
  for (const cmd of commands) {
    let ok = false;
    let output = "";
    if (!shellCommandAllowed(cmd)) {
      output = "Destructive command blocked by cursor-goal-runtime.";
    } else {
      try {
        execSync(cmd, {
          cwd: root,
          stdio: "pipe",
          encoding: "utf8",
          shell: "/bin/bash",
          ...(timeoutMs > 0 ? { timeout: timeoutMs, killSignal: "SIGKILL" } : {}),
        });
        ok = true;
      } catch (err) {
        ok = false;
        output = captureExecError(err);
        const e = err as { code?: string; signal?: string; killed?: boolean };
        if (
          timeoutMs > 0 &&
          (e?.code === "ETIMEDOUT" || e?.signal === "SIGKILL" || e?.signal === "SIGTERM" || e?.killed)
        ) {
          const source = process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS ? "CURSOR_GOAL_CHECK_TIMEOUT_MS" : "default";
          output = `check timed out after ${timeoutMs}ms (${source})\n${output}`;
        }
      }
    }
    const row = { cmd, ok, tree, ...(output ? { output } : {}) };
    results.push(row);
    await appendFile(
      proofRunsPath,
      JSON.stringify({ at: new Date().toISOString(), cmd, ok, tree, output: output || undefined }) +
        "\n",
      "utf8",
    );
  }
  return results;
}
