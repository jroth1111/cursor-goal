import { existsSync } from "node:fs";
import { readdir, readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { compileGoalV2 } from "../compile/compile-v2.js";
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
import { runWrappedCommand } from "../lib/command-run.js";
import {
  buildIncidentReport,
  formatIncidentReport,
  InvalidIncidentsSinceError,
} from "../lib/incidents.js";
import {
  formatSessionEndDiagnostics,
  readSessionEndDiagnostics,
} from "../lib/session-end-report.js";
import { operatorOptionsFromArgv } from "./shared.js";

const doctorOptions = new Set(["--json", "--fix", "--strict"]);
const nextOptions = new Set(["--json", "--verbose"]);
const explainOptions = new Set(["--json"]);
const runOptions = new Set(["--json"]);
const statusOptions = new Set(["--json"]);
const incidentsOptions = new Set(["--json"]);
const sessionEndClearOptions = new Set(["--force"]);
const conversationValueOptions = new Set(["--conversation"]);
const runValueOptions = new Set(["--timeout-ms"]);
const incidentsValueOptions = new Set(["--since"]);
const dispatchFlags = new Set(["--dry-run", "--run", "--verify", "--spawn"]);
const dispatchValueOptions = new Set(["--unit", "--record-response", "--from"]);

export async function handleVerify(rest: string[]): Promise<void> {
  rejectUnsupportedOperatorArgs(rest, new Set(), conversationValueOptions);
  await compileGoalV2(projectRoot()).catch(() => undefined);
  const r = await runStopVerifier({
    status: "completed",
    loop_count: 0,
    conversation_id: operatorOptionsFromArgv(rest)?.conversation_id,
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.kind === "release" ? 0 : 1);
}

export async function handleRun(rest: string[], source = "cursor-goal run"): Promise<void> {
  const { json, timeoutMs, commandTokens } = parseRunArgs(rest);
  try {
    const result = await runWrappedCommand(projectRoot(), commandTokens, { timeoutMs, source });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.output) {
      process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}\n`);
    }
    process.exit(result.status);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
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
  const seenValueOptions = new Set<string>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (allowedFlags.has(arg)) continue;
    if (valueOptions.has(arg)) {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      if (seenValueOptions.has(arg)) {
        console.error(`Duplicate option: ${arg}`);
        process.exit(1);
      }
      seenValueOptions.add(arg);
      i += 1;
      continue;
    }
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }
}

function rejectUnsupportedDispatchArgs(rest: string[]): void {
  const seenValueOptions = new Set<string>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (dispatchFlags.has(arg)) continue;
    if (dispatchValueOptions.has(arg)) {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      if (seenValueOptions.has(arg)) {
        console.error(`Duplicate option: ${arg}`);
        process.exit(1);
      }
      seenValueOptions.add(arg);
      i += 1;
      continue;
    }
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }
}

function parseRunArgs(rest: string[]): { json: boolean; timeoutMs?: number; commandTokens: string[] } {
  const delimiter = rest.indexOf("--");
  const optionArgs = delimiter >= 0 ? rest.slice(0, delimiter) : rest;
  const commandTokens = delimiter >= 0 ? rest.slice(delimiter + 1) : [];
  let json = false;
  let timeoutMs: number | undefined;
  const seenValueOptions = new Set<string>();

  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    if (runOptions.has(arg)) {
      json = true;
      continue;
    }
    if (runValueOptions.has(arg)) {
      const value = optionArgs[i + 1];
      if (!value || value.startsWith("-")) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      if (seenValueOptions.has(arg)) {
        console.error(`Duplicate option: ${arg}`);
        process.exit(1);
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        console.error(`Invalid value for ${arg}: ${value}`);
        process.exit(1);
      }
      timeoutMs = parsed;
      seenValueOptions.add(arg);
      i += 1;
      continue;
    }
    if (delimiter < 0) {
      commandTokens.push(...optionArgs.slice(i));
      break;
    }
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }

  return { json, timeoutMs, commandTokens };
}

function parseIncidentsArgs(rest: string[]): { json: boolean; since: string } {
  let json = false;
  let since = "today";
  const seenValueOptions = new Set<string>();

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (incidentsOptions.has(arg)) {
      json = true;
      continue;
    }
    if (incidentsValueOptions.has(arg)) {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      if (seenValueOptions.has(arg)) {
        console.error(`Duplicate option: ${arg}`);
        process.exit(1);
      }
      since = value;
      seenValueOptions.add(arg);
      i += 1;
      continue;
    }
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }

  return { json, since };
}

function isDispatchVerifyRejection(text: string): boolean {
  return /^(No work units|Unknown unit|No unit with verified_by|Missing deliverable:)/.test(text);
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

  if (dryRun && run) {
    console.error("dispatch --dry-run cannot be combined with --run");
    process.exit(1);
  }
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
    const text = await formatDispatchVerifyCli(projectRoot(), unitId);
    if (isDispatchVerifyRejection(text)) {
      console.error(text);
      process.exit(1);
    }
    console.log(text);
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
  if (rest[0] === "session-end") {
    const args = rest.slice(1);
    rejectUnsupportedOperatorArgs(args, explainOptions, new Set());
    const diagnostics = await readSessionEndDiagnostics(projectRoot());
    if (args.includes("--json")) {
      console.log(JSON.stringify(diagnostics ?? {}, null, 2));
    } else {
      console.log(formatSessionEndDiagnostics(diagnostics));
    }
    process.exit(diagnostics ? 0 : 1);
  }

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

export async function handleSessionEnd(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub !== "clear") {
    console.error(`Unknown session-end subcommand: ${sub ?? "(missing)"}`);
    console.error("Usage: cursor-goal session-end clear [--force]");
    process.exit(1);
  }
  const args = rest.slice(1);
  for (const a of args) {
    if (sessionEndClearOptions.has(a)) continue;
    console.error(a.startsWith("-") ? `Unknown option: ${a}` : `Unexpected argument: ${a}`);
    process.exit(1);
  }
  const force = args.includes("--force");
  const root = projectRoot();
  const diagnostics = await readSessionEndDiagnostics(root);
  if (!diagnostics) {
    console.log("No SESSION_END diagnostics found.");
    process.exit(0);
  }
  if (!force) {
    console.log(formatSessionEndDiagnostics(diagnostics));
    console.log("");
    console.error("Refusing to clear SESSION_END without --force.");
    console.error("Next: cursor-goal session-end clear --force");
    process.exit(1);
  }
  await unlink(path.join(goalDir(root), "passports", "SESSION_END.json")).catch(() => undefined);
  await unlink(path.join(goalDir(root), "passports", "SESSION_END.md")).catch(() => undefined);
  console.log("Cleared SESSION_END.");
  process.exit(0);
}

export async function handleIncidents(rest: string[]): Promise<void> {
  const { json, since } = parseIncidentsArgs(rest);
  let report;
  try {
    report = await buildIncidentReport(projectRoot(), since);
  } catch (err) {
    if (err instanceof InvalidIncidentsSinceError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatIncidentReport(report));
  }
  process.exit(0);
}

export async function handleDoctor(rest: string[]): Promise<void> {
  rejectUnsupportedOptionOnlyArgs(rest, doctorOptions);
  const json = rest.includes("--json");
  const fix = rest.includes("--fix");
  const strict = rest.includes("--strict");
  const actions = fix ? await applyDoctorFixes(projectRoot()) : [];
  const report = await buildDoctorReport(projectRoot(), { strict });
  if (json) {
    console.log(JSON.stringify(fix ? { ...report, fixes: actions } : report, null, 2));
    process.exit(report.issues.some((i) => i.level === "error") ? 1 : 0);
  }
  if (fix) {
    for (const a of actions) console.log(`fix: ${a}`);
  }
  const issues = report.issues;
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

export async function handleSessions(rest: string[]): Promise<void> {
  rejectUnsupportedOptionOnlyArgs(rest, new Set(["--json"]));
  const json = rest.includes("--json");
  const root = projectRoot();
  const sessionsDir = path.join(goalDir(root), "passports", "sessions");
  if (!existsSync(sessionsDir)) {
    if (json) console.log("[]");
    else console.log("No session history found.");
    process.exit(0);
  }
  const entries = await readdir(sessionsDir);
  const sessionFiles = entries.filter((f) => f.startsWith("SESSION_END_") && f.endsWith(".json")).sort().reverse();
  if (sessionFiles.length === 0) {
    if (json) console.log("[]");
    else console.log("No session history found.");
    process.exit(0);
  }
  const sessions: Record<string, unknown>[] = [];
  for (const f of sessionFiles.slice(0, 20)) {
    try {
      const data = JSON.parse(await readFile(path.join(sessionsDir, f), "utf8")) as Record<string, unknown>;
      sessions.push(data);
    } catch {
      /* skip malformed */
    }
  }
  if (json) {
    console.log(JSON.stringify(sessions, null, 2));
    process.exit(0);
  }
  for (const s of sessions) {
    const at = typeof s.at === "string" ? s.at : "unknown";
    const reason = typeof s.reason === "string" ? s.reason : "unknown";
    const failure = typeof s.failure_class === "string" ? s.failure_class : "";
    const duration = typeof s.duration_ms === "number" ? ` (${Math.round(s.duration_ms / 1000)}s)` : "";
    console.log(`- ${at} | ${reason}${failure ? ` (${failure})` : ""}${duration}`);
  }
  process.exit(0);
}
