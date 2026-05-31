import { existsSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
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

const doctorOptions = new Set(["--json", "--fix"]);
const nextOptions = new Set(["--json", "--verbose"]);
const explainOptions = new Set(["--json"]);
const statusOptions = new Set(["--json"]);
const conversationValueOptions = new Set(["--conversation"]);
const dispatchFlags = new Set(["--dry-run", "--run", "--verify", "--spawn"]);
const dispatchValueOptions = new Set(["--unit", "--record-response", "--from"]);

export async function handleVerify(rest: string[]): Promise<void> {
  rejectUnexpectedArgs(rest);
  const r = await runStopVerifier({ status: "completed", loop_count: 0 });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.kind === "release" ? 0 : 1);
}

function optionValue(rest: string[], option: string): string | undefined {
  const idx = rest.indexOf(option);
  if (idx < 0) return undefined;
  const value = rest[idx + 1];
  if (!value || value.startsWith("-")) {
    console.error(`Missing value for ${option}`);
    process.exit(1);
  }
  return value;
}

function rejectUnexpectedArgs(rest: string[]): void {
  const arg = rest[0];
  if (!arg) return;
  console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
  process.exit(1);
}

function rejectUnsupportedOptionOnlyArgs(rest: string[], allowed: Set<string>): void {
  for (const arg of rest) {
    if (allowed.has(arg)) continue;
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }
}

function rejectUnsupportedOperatorArgs(
  rest: string[],
  allowedFlags: Set<string>,
  valueOptions = conversationValueOptions,
): void {
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (allowedFlags.has(arg)) continue;
    if (valueOptions.has(arg)) {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      i += 1;
      continue;
    }
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }
}

function rejectUnsupportedDispatchArgs(rest: string[]): void {
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (dispatchFlags.has(arg)) continue;
    if (dispatchValueOptions.has(arg)) {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      i += 1;
      continue;
    }
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }
}

function parseLogsTailArg(rest: string[]): number {
  let tail = 20;
  let seenTail = false;
  for (const arg of rest) {
    if (/^\d+$/.test(arg)) {
      if (seenTail) {
        console.error(`Unexpected argument: ${arg}`);
        process.exit(1);
      }
      seenTail = true;
      tail = Number(arg);
      continue;
    }
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }
  return tail;
}

export async function handleNext(rest: string[]): Promise<void> {
  rejectUnsupportedOperatorArgs(rest, nextOptions);
  const verbose = rest.includes("--verbose");
  if (rest.includes("--json") && verbose) {
    console.error("next --json cannot be combined with --verbose");
    process.exit(1);
  }
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
  const unitId = optionValue(rest, "--unit");
  const recordUnit = optionValue(rest, "--record-response");
  const fromFile = optionValue(rest, "--from");
  rejectUnsupportedDispatchArgs(rest);

  if (unitId && !verify) {
    console.error("dispatch --unit requires --verify");
    process.exit(1);
  }
  if (verifySpawn && !verify) {
    console.error("dispatch --spawn requires --verify");
    process.exit(1);
  }
  if (verify && dryRun && !verifySpawn) {
    console.error("dispatch --dry-run with --verify requires --spawn");
    process.exit(1);
  }
  if (verify && run) {
    console.error("dispatch --run cannot be combined with --verify");
    process.exit(1);
  }

  if (recordUnit && !fromFile) {
    console.error("dispatch --record-response <id> requires --from <file>");
    process.exit(1);
  }
  if (fromFile && !recordUnit) {
    console.error("dispatch --from <file> requires --record-response <id>");
    process.exit(1);
  }

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
  const n = parseLogsTailArg(rest);
  const entries = await readStopTraceTail(projectRoot(), n);
  console.log(JSON.stringify(entries, null, 2));
  process.exit(0);
}

export async function handleUpgrade(rest: string[]): Promise<void> {
  rejectUnexpectedArgs(rest);
  const r = runGlobalUpgrade();
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.status);
}

export async function handleExplain(rest: string[]): Promise<void> {
  rejectUnsupportedOperatorArgs(rest, explainOptions);
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
  rejectUnsupportedOptionOnlyArgs(rest, doctorOptions);
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

export async function handlePause(rest: string[]): Promise<void> {
  rejectUnexpectedArgs(rest);
  await mkdir(goalDir(), { recursive: true });
  await writeFile(path.join(goalDir(), "PAUSED"), "", "utf8");
  console.log("Paused");
}

export async function handleResume(rest: string[]): Promise<void> {
  rejectUnexpectedArgs(rest);
  const p = path.join(goalDir(), "PAUSED");
  if (existsSync(p)) await unlink(p);
  console.log("Resumed");
}

export async function handleStatus(rest: string[]): Promise<void> {
  if (rest.includes("--json")) {
    rejectUnsupportedOperatorArgs(rest, statusOptions);
    const snap = await buildOperatorSnapshot(projectRoot(), operatorOptionsFromArgv(rest));
    if ("error" in snap) {
      console.error(snap.error);
      process.exit(1);
    }
    console.log(JSON.stringify(snap, null, 2));
    process.exit(0);
  }
  rejectUnsupportedOperatorArgs(rest, statusOptions, new Set());
  console.log(await formatOperatorStatus());
}
