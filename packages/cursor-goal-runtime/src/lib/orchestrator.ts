import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { goalDir, goalMd, projectRoot, readJson } from "./paths.js";
import type { VerifierContext } from "../verifier/types.js";

export type OrchestratorConfig = {
  audit_dir: string;
  marker: string;
  status_file: string;
  master_status: string;
  final_report: string;
  required_done: string[];
  check_command: string;
};

const DEFAULT_CONFIG: OrchestratorConfig = {
  audit_dir: ".cursor-audit/orchestrator",
  marker: "ORCHESTRATOR_ACTIVE",
  status_file: "ORCHESTRATOR_STATUS.json",
  master_status: "MASTER_STATUS.md",
  final_report: "FINAL_REPORT.md",
  required_done: ["Phase 1"],
  check_command: "node .cursor/goal/scripts/check-orchestrator-status.mjs",
};

export function orchestratorConfigPath(root: string): string {
  return path.join(goalDir(root), "orchestrator.json");
}

export async function readOrchestratorConfig(root: string): Promise<OrchestratorConfig | null> {
  const file = orchestratorConfigPath(root);
  if (!existsSync(file)) return null;
  const raw = await readJson<Partial<OrchestratorConfig>>(file);
  if (!raw) return null;
  return { ...DEFAULT_CONFIG, ...raw };
}

export async function writeOrchestratorConfig(
  root: string,
  patch: Partial<OrchestratorConfig>,
): Promise<OrchestratorConfig> {
  const cur = (await readOrchestratorConfig(root)) ?? { ...DEFAULT_CONFIG };
  const next = { ...cur, ...patch };
  await mkdir(path.dirname(orchestratorConfigPath(root)), { recursive: true });
  await writeFile(orchestratorConfigPath(root), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function orchestratorMarkerPath(root: string, config: OrchestratorConfig): string {
  return path.join(root, config.audit_dir, config.marker);
}

export async function isOrchestratorActive(root: string): Promise<boolean> {
  const config = await readOrchestratorConfig(root);
  if (!config) return false;
  return existsSync(orchestratorMarkerPath(root, config));
}

export function parseOrchestratorFollowup(output: string): string | null {
  const lines = output.split(/\r?\n/);
  const mustDone = lines.filter((l) => /must be `?DONE`?/i.test(l) || /must be DONE/i.test(l));
  const bullets = lines.filter((l) => l.trim().startsWith("- ") && /=/.test(l));
  const picked = mustDone.length ? mustDone : bullets;
  if (!picked.length) return null;
  return [
    "Orchestrator run incomplete. Remaining work:",
    ...picked.slice(0, 12).map((l) => l.trim()),
    "",
    "Update MASTER_STATUS.md (or ORCHESTRATOR_STATUS.json) then rerun checks.",
  ].join("\n");
}

export async function enrichOrchestratorFollowup(ctx: VerifierContext): Promise<void> {
  const config = await readOrchestratorConfig(ctx.root);
  if (!config) return;
  const failed = ctx.checkResults.find(
    (c) => !c.ok && (c.cmd === config.check_command || c.cmd.includes("check-orchestrator-status")),
  );
  if (!failed?.output) return;
  const msg = parseOrchestratorFollowup(failed.output);
  if (msg) ctx.followupMessage = msg;
}

export async function appendOrchestratorCheckToGoal(root: string, checkCommand: string): Promise<void> {
  const goalPath = goalMd(root);
  if (!existsSync(goalPath)) return;
  const text = await readFile(goalPath, "utf8");
  if (text.includes(checkCommand)) return;
  const checksHeader = /^## Checks\s*$/im;
  if (!checksHeader.test(text)) {
    await writeFile(
      goalPath,
      `${text.trim()}\n\n## Checks\n- \`${checkCommand}\`\n`,
      "utf8",
    );
    return;
  }
  const lines = text.split("\n");
  const out: string[] = [];
  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (!inserted && /^## Checks\s*$/i.test(lines[i].trim())) {
      out.push(`- \`${checkCommand}\``);
      inserted = true;
    }
  }
  if (!inserted) out.push(`- \`${checkCommand}\``);
  await writeFile(goalPath, out.join("\n"), "utf8");
}

export async function readOrchestratorStatus(root: string): Promise<{
  active: boolean;
  incomplete: string[];
  audit_dir: string | null;
  master_status: string | null;
}> {
  const config = await readOrchestratorConfig(root);
  if (!config) {
    return { active: false, incomplete: [], audit_dir: null, master_status: null };
  }
  const active = existsSync(orchestratorMarkerPath(root, config));
  const incomplete: string[] = [];
  const statusPath = path.join(root, config.audit_dir, config.status_file);
  if (existsSync(statusPath)) {
    try {
      const json = JSON.parse(await readFile(statusPath, "utf8")) as {
        phaseStatuses?: Record<string, string>;
        statuses?: Record<string, string>;
        requiredDone?: string[];
      };
      const statuses = json.phaseStatuses ?? json.statuses ?? {};
      const required = json.requiredDone ?? config.required_done;
      for (const label of required) {
        if (statuses[label] !== "DONE") incomplete.push(label);
      }
    } catch {
      incomplete.push("(status file unreadable)");
    }
  } else if (active) {
    incomplete.push(...config.required_done);
  }
  return {
    active,
    incomplete,
    audit_dir: config.audit_dir,
    master_status: path.join(config.audit_dir, config.master_status),
  };
}
