import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { passportsDir } from "./paths.js";

export type SessionEndDiagnostics = {
  status?: string;
  reason?: string;
  duration_ms?: number;
  failure_class?: string;
  why_no_release?: string;
  had_governed_contract?: boolean;
  root?: string;
  git_tree?: string;
  runtime_root?: string | null;
  install_git_sha?: string | null;
  install_source?: string | null;
  last_stop_trace?: { level_failed?: string | null; pipeline_result?: string; failures?: string[] } | null;
  last_check_result?: { cmd?: string; ok?: boolean; elapsed_ms?: number; output?: string } | null;
};

export async function readSessionEndDiagnostics(root: string): Promise<SessionEndDiagnostics | null> {
  const file = path.join(passportsDir(root), "SESSION_END.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as SessionEndDiagnostics;
}

export function formatSessionEndDiagnostics(d: SessionEndDiagnostics | null): string {
  if (!d) return "No SESSION_END diagnostics found.";
  const lines = [
    "Session ended without RELEASE",
    "",
    `failure_class: ${d.failure_class ?? "unknown"}`,
    `reason: ${d.reason ?? "unknown"}`,
    `why: ${d.why_no_release ?? "unknown"}`,
    ...(d.duration_ms != null ? [`duration_ms: ${d.duration_ms}`] : []),
    `had_governed_contract: ${d.had_governed_contract === true ? "true" : d.had_governed_contract === false ? "false" : "unknown"}`,
  ];
  if (d.root) lines.push(`root: ${d.root}`);
  if (d.git_tree) lines.push(`git_tree: ${d.git_tree}`);
  if (d.runtime_root) lines.push(`runtime_root: ${d.runtime_root}`);
  if (d.install_git_sha) lines.push(`install_git_sha: ${d.install_git_sha}`);
  if (d.last_stop_trace) {
    lines.push(
      "",
      "last_stop:",
      `  result: ${d.last_stop_trace.pipeline_result ?? "unknown"}`,
      `  level_failed: ${d.last_stop_trace.level_failed ?? "none"}`,
    );
  }
  if (d.last_check_result) {
    lines.push(
      "",
      "last_check:",
      `  cmd: ${d.last_check_result.cmd ?? "unknown"}`,
      `  ok: ${d.last_check_result.ok === true ? "true" : d.last_check_result.ok === false ? "false" : "unknown"}`,
    );
    if (typeof d.last_check_result.elapsed_ms === "number") {
      lines.push(`  elapsed_ms: ${d.last_check_result.elapsed_ms}`);
    }
    if (d.last_check_result.output) {
      lines.push("  output:", `    ${d.last_check_result.output.slice(0, 500).replace(/\r?\n/g, "\n    ")}`);
    }
  }
  return lines.join("\n");
}
