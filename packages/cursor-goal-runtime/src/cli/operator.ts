import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { runStopVerifier } from "../lib/verify.js";
import { goalDir, projectRoot } from "../lib/paths.js";
import {
  buildOperatorNextAction,
  buildOperatorSnapshot,
  formatOperatorStatus,
} from "../lib/operator.js";
import { formatDispatchCli, runSupervisorDispatch } from "../lib/dispatch-cli.js";
import { runDoctor, buildDoctorReport, applyDoctorFixes } from "../lib/doctor.js";
import { buildExplainReport, formatExplainReport } from "../lib/explain-stop.js";
import {
  formatDispatchVerifyCli,
  recordVerifierFromFile,
  runDispatchVerifySpawn,
} from "../lib/dispatch-verify.js";
import { readStopTraceTail } from "../lib/stop-trace.js";
import { runGlobalUpgrade } from "../lib/upgrade.js";
import { operatorOptionsFromArgv } from "./shared.js";

export async function handleVerify(): Promise<void> {
  const r = await runStopVerifier({ status: "completed", loop_count: 0 });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.kind === "release" ? 0 : 1);
}

export async function handleNext(rest: string[]): Promise<void> {
  const verbose = rest.includes("--verbose");
  if (rest.includes("--json")) {
    const snap = await buildOperatorSnapshot(projectRoot(), operatorOptionsFromArgv(rest));
    if ("error" in snap) {
      console.error(snap.error);
      process.exit(1);
    }
    console.log(JSON.stringify(snap, null, 2));
    process.exit(0);
  }
  if (verbose) {
    const report = await buildExplainReport({
      status: "completed",
      conversation_id: operatorOptionsFromArgv(rest)?.conversation_id,
    });
    console.log(formatExplainReport(report));
    process.exit(0);
  }
  console.log(await buildOperatorNextAction(projectRoot(), operatorOptionsFromArgv(rest)));
  process.exit(0);
}

export async function handleDispatch(rest: string[]): Promise<void> {
  const dryRun = rest.includes("--dry-run");
  const run = rest.includes("--run");
  const verify = rest.includes("--verify");
  const verifySpawn = rest.includes("--spawn");
  const unitIdx = rest.indexOf("--unit");
  const unitId = unitIdx >= 0 ? rest[unitIdx + 1] : undefined;
  const recordIdx = rest.indexOf("--record-response");
  const recordUnit = recordIdx >= 0 ? rest[recordIdx + 1] : undefined;
  const fromIdx = rest.indexOf("--from");
  const fromFile = fromIdx >= 0 ? rest[fromIdx + 1] : undefined;

  if (recordUnit && fromFile) {
    const r = await recordVerifierFromFile(recordUnit, fromFile);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.passed ? 0 : 1);
  }

  if (verify && verifySpawn) {
    try {
      const r = await runDispatchVerifySpawn(projectRoot(), { unitId, dryRun });
      if (dryRun) {
        process.exit(0);
      }
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.passed ? 0 : 1);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }

  if (verify) {
    console.log(await formatDispatchVerifyCli(projectRoot(), unitId));
    process.exit(0);
  }

  if (run || dryRun) {
    const r = runSupervisorDispatch(projectRoot(), { dryRun, unitsOnly: true });
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exit(r.status);
  }
  console.log(await formatDispatchCli());
  process.exit(0);
}

export async function handleLogs(rest: string[]): Promise<void> {
  const tailArg = rest.find((a) => /^\d+$/.test(a));
  const n = tailArg ? Number(tailArg) : 20;
  const entries = await readStopTraceTail(projectRoot(), n);
  console.log(JSON.stringify(entries, null, 2));
  process.exit(0);
}

export async function handleUpgrade(): Promise<void> {
  const r = runGlobalUpgrade();
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.status);
}

export async function handleExplain(rest: string[]): Promise<void> {
  const report = await buildExplainReport({
    status: "completed",
    conversation_id: operatorOptionsFromArgv(rest)?.conversation_id,
  });
  if (rest.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatExplainReport(report));
  }
  process.exit(0);
}

export async function handleDoctor(rest: string[]): Promise<void> {
  const json = rest.includes("--json");
  const fix = rest.includes("--fix");
  if (fix) {
    const actions = await applyDoctorFixes(projectRoot());
    for (const a of actions) console.log(`fix: ${a}`);
  }
  if (json) {
    console.log(JSON.stringify(await buildDoctorReport(), null, 2));
    process.exit((await runDoctor()).some((i) => i.level === "error") ? 1 : 0);
  }
  const issues = await runDoctor();
  for (const i of issues) console.log(`${i.level}: ${i.message}`);
  process.exit(issues.some((i) => i.level === "error") ? 1 : 0);
}

export async function handlePause(): Promise<void> {
  await writeFile(path.join(goalDir(), "PAUSED"), "", "utf8");
  console.log("Paused");
}

export async function handleResume(): Promise<void> {
  const p = path.join(goalDir(), "PAUSED");
  if (existsSync(p)) await unlink(p);
  console.log("Resumed");
}

export async function handleStatus(rest: string[]): Promise<void> {
  if (rest.includes("--json")) {
    const snap = await buildOperatorSnapshot(projectRoot(), operatorOptionsFromArgv(rest));
    if ("error" in snap) {
      console.error(snap.error);
      process.exit(1);
    }
    console.log(JSON.stringify(snap, null, 2));
    process.exit(0);
  }
  console.log(await formatOperatorStatus());
}
