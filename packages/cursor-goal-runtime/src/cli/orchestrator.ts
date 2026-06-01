import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../lib/paths.js";
import { compileGoalV2 } from "../compile/compile-v2.js";
import { writeSessionMode } from "../lib/governance-config.js";
import {
  appendOrchestratorCheckToGoal,
  isOrchestratorActive,
  orchestratorMarkerPath,
  readOrchestratorConfig,
  readOrchestratorStatus,
  writeOrchestratorConfig,
  type OrchestratorConfig,
} from "../lib/orchestrator.js";

const usage =
  "Usage: cursor-goal orchestrator init [--dir <audit_dir>] | start | finish [--keep-check] | status [--json]";

function rejectUsage(): never {
  console.error(usage);
  process.exit(1);
}

export async function handleOrchestrator(rest: string[]): Promise<void> {
  const root = projectRoot();
  const sub = rest[0];
  if (!sub) rejectUsage();

  if (sub === "init") {
    let auditDir = ".cursor-audit/orchestrator";
    const dirIdx = rest.indexOf("--dir");
    if (dirIdx >= 0 && rest[dirIdx + 1]) auditDir = rest[dirIdx + 1];
    const config = await writeOrchestratorConfig(root, { audit_dir: auditDir });
    await mkdir(path.join(root, auditDir), { recursive: true });
    console.log(`Wrote ${path.join(".cursor/goal/orchestrator.json")}`);
    console.log(`Audit dir: ${config.audit_dir}`);
    return;
  }

  if (sub === "status") {
    const json = rest.includes("--json");
    const status = await readOrchestratorStatus(root);
    if (json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`active: ${status.active}`);
      if (status.audit_dir) console.log(`audit_dir: ${status.audit_dir}`);
      if (status.master_status) console.log(`master_status: ${status.master_status}`);
      if (status.incomplete.length) {
        console.log("incomplete:");
        for (const line of status.incomplete) console.log(`  - ${line}`);
      }
    }
    return;
  }

  const config = await readOrchestratorConfig(root);
  if (!config && sub !== "init") {
    console.error("orchestrator.json missing — run: cursor-goal orchestrator init");
    process.exit(1);
  }
  const cfg = config!;

  if (sub === "start") {
    await mkdir(path.join(root, cfg.audit_dir), { recursive: true });
    await writeFile(orchestratorMarkerPath(root, cfg), `${new Date().toISOString()}\n`, "utf8");
    await appendOrchestratorCheckToGoal(root, cfg.check_command);
    try {
      await compileGoalV2(root);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`compile warning: ${msg}`);
    }
    await writeSessionMode(root, "governed", "cli");
    console.log(`Orchestrator started (marker: ${path.join(cfg.audit_dir, cfg.marker)})`);
    console.log("Session mode: governed");
    return;
  }

  if (sub === "finish") {
    if (!(await isOrchestratorActive(root))) {
      console.log("Orchestrator not active (no marker)");
      return;
    }
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(cfg.check_command, {
      cwd: root,
      shell: true,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      process.stderr.write(r.stderr ?? r.stdout ?? "orchestrator check failed\n");
      process.exit(r.status ?? 1);
    }
    const marker = orchestratorMarkerPath(root, cfg);
    const { unlink } = await import("node:fs/promises");
    await unlink(marker).catch(() => undefined);
    if (!rest.includes("--keep-check")) {
      console.log("Marker removed. Use --keep-check to leave GOAL check in place.");
    }
    console.log("Orchestrator finished");
    return;
  }

  rejectUsage();
}
