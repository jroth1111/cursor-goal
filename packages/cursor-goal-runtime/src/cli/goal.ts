import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { compileGoalV2 } from "../compile/compile-v2.js";
import { goalDir, goalMd, projectRoot } from "../lib/paths.js";
import {
  advancePhase,
  completeDiscovery,
  readTrajectory,
  writeTrajectory,
  type Phase,
} from "../trajectory/fsm.js";
import { findUnitById, readWorkUnits, markUnitDone, pendingUnits } from "../lib/work-units.js";
import { checkUnitCompletionEvidence } from "../lib/unit-evidence.js";
import { lintGoalMd } from "../lib/goal-lint.js";
import { goalTemplatePath } from "../lib/template.js";
import { applyDetectedChecks } from "../lib/goal-detect.js";
import { startCompileWatch } from "../lib/compile-watch.js";
import { previewInteractiveGoal, writeInteractiveGoal } from "../lib/init-interactive.js";
import { parseGoalMd } from "../lib/parse-goal-md.js";

const unitsUsage = "Usage: cursor-goal units list | cursor-goal units done <id>";
const validDirectSetPhases = new Set<Phase>([
  "INTAKE",
  "DISCOVERY",
  "PLAN",
  "IMPLEMENT",
  "VERIFY",
  "DONE",
]);
const initOptions = new Set(["--compile", "--detect", "--interactive", "--force", "--dry-run", "--probe-acceptance"]);
const compileOptions = new Set(["--watch"]);
const discoveryCompleteOptions = new Set(["--plan-only"]);

function parseDirectSetPhase(value: string): Phase | null {
  return validDirectSetPhases.has(value as Phase) ? (value as Phase) : null;
}

function rejectUnknownOptions(rest: string[], allowed: Set<string>): void {
  const unknown = rest.find((arg) => arg.startsWith("-") && !allowed.has(arg));
  if (unknown) {
    console.error(`Unknown option: ${unknown}`);
    process.exit(1);
  }
}

function rejectUnsupportedOptionOnlyArgs(rest: string[], allowed: Set<string>): void {
  for (const arg of rest) {
    if (allowed.has(arg)) continue;
    console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
    process.exit(1);
  }
}

function rejectUnexpectedArg(arg: string | undefined): void {
  if (!arg) return;
  console.error(arg.startsWith("-") ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`);
  process.exit(1);
}

export async function seedGoal(): Promise<void> {
  const root = projectRoot();
  const template = goalTemplatePath();
  const dest = goalMd(root);
  if (!existsSync(dest)) {
    await copyFile(template, dest);
    console.log(`Created ${dest}`);
  }
  await mkdir(goalDir(root), { recursive: true });
}

export async function handleInit(rest: string[]): Promise<void> {
  rejectUnsupportedOptionOnlyArgs(rest, initOptions);
  const doCompile = rest.includes("--compile");
  const doDetect = rest.includes("--detect");
  const forceInteractive = rest.includes("--interactive");
  const forceOverwrite = rest.includes("--force");
  const dryRun = rest.includes("--dry-run");
  const probeAcceptance = rest.includes("--probe-acceptance");

  if (forceInteractive) {
    const dest = goalMd(projectRoot());
    const existed = existsSync(dest);
    if (existed && !forceOverwrite) {
      console.error("GOAL.md already exists; use --force to overwrite or edit in place");
      process.exit(1);
    }
    if (dryRun) {
      const preview = await previewInteractiveGoal(projectRoot());
      console.log(preview);
      console.error(`${existed && forceOverwrite ? "Would write" : "Would create"} ${dest} (dry-run)`);
      if (doCompile || doDetect) {
        console.error("Note: --compile and --detect are not applied in dry-run mode");
      }
      return;
    }
    await writeInteractiveGoal(projectRoot());
    console.log(`${existed && forceOverwrite ? "Wrote" : "Created"} ${dest}`);
    if (doDetect) {
      const detected = await applyDetectedChecks(projectRoot());
      console.log(`Detected checks from ${detected.source}: ${detected.commands.join(", ")}`);
      await reportAcceptanceBootstrap(projectRoot(), probeAcceptance);
    }
    if (doCompile) {
      await compileGoalV2();
      console.log("Initialized GOAL.md and compiled artifacts");
    } else {
      console.log("Edit GOAL.md as needed, then run: cursor-goal compile");
    }
    return;
  }

  await seedGoal();
  if (doDetect) {
    const detected = await applyDetectedChecks(projectRoot());
    console.log(`Detected checks from ${detected.source}: ${detected.commands.join(", ")}`);
    await reportAcceptanceBootstrap(projectRoot(), probeAcceptance);
  }
  if (doCompile) {
    await compileGoalV2();
    console.log("Initialized GOAL.md and compiled artifacts");
  } else {
    console.log("Initialized GOAL.md — edit checks, then run: cursor-goal compile");
  }
}

async function reportAcceptanceBootstrap(root: string, probeAcceptance: boolean): Promise<void> {
  if (!probeAcceptance) {
    console.log("Acceptance probes skipped by default; acceptance not probed.");
    console.log("Suggested GOAL.md bootstrap: review scope-derived units and add explicit acceptance before compile.");
    return;
  }

  const parsed = await parseGoalMd(root);
  const commands = parsed.workUnits.flatMap((u) => u.acceptance);
  if (commands.length === 0) {
    console.log("Acceptance probes requested, but no unit acceptance commands were found.");
    return;
  }

  const failures: string[] = [];
  for (const cmd of commands) {
    const r = spawnSync("bash", ["-lc", cmd], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if ((r.status ?? 1) !== 0) failures.push(cmd);
  }

  if (failures.length === 0) {
    console.log("acceptance would pass today");
  } else {
    console.log(`acceptance would fail today: ${failures.join(", ")}`);
  }
}

export async function handleCompile(rest: string[]): Promise<void> {
  rejectUnsupportedOptionOnlyArgs(rest, compileOptions);
  if (rest.includes("--watch")) {
    startCompileWatch(projectRoot());
    await new Promise(() => {});
    return;
  }
  await compileGoalV2();
  console.log("Compiled GOAL.md → .cursor/goal/");
}

export async function handleGoal(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === "lint") {
    rejectUnexpectedArg(rest[1]);
    const issues = await lintGoalMd(projectRoot());
    for (const i of issues) console.log(`${i.level}: ${i.message}`);
    process.exit(issues.some((i) => i.level === "error") ? 1 : 0);
  }
  console.log("Usage: cursor-goal goal lint");
  process.exit(1);
}

export async function handlePhase(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === "advance") {
    rejectUnexpectedArg(rest[2]);
    const to = (rest[1] ?? "IMPLEMENT") as Parameters<typeof advancePhase>[0];
    const r = await advancePhase(to);
    if (!r.ok) {
      console.error(r.error);
      process.exit(1);
    }
    console.log(`phase=${to}`);
  } else {
    rejectUnexpectedArg(rest[1]);
    const raw = sub ?? "IMPLEMENT";
    const phase = parseDirectSetPhase(raw);
    if (!phase) {
      console.error(`Invalid phase: ${raw}`);
      process.exit(1);
    }
    await writeTrajectory({ phase });
    console.log(`phase=${phase} (direct set)`);
  }
}

export async function handleDiscovery(rest: string[]): Promise<void> {
  if (rest[0] === "complete") {
    rejectUnknownOptions(rest.slice(1), discoveryCompleteOptions);
    const planOnly = rest.includes("--plan-only");
    const notes =
      rest.filter((x) => x !== "--plan-only").slice(1).join(" ") || "discovery complete";
    const before = await readTrajectory();
    await completeDiscovery(notes, undefined, { planOnly });
    const after = await readTrajectory();
    if (before.phase !== after.phase) {
      console.log(`discovery completed; phase advanced to ${after.phase}`);
    } else {
      console.log(`discovery completed; phase remains ${after.phase}`);
    }
  } else {
    console.log("Usage: cursor-goal discovery complete [--plan-only] [notes]");
    process.exit(1);
  }
}

export async function handleUnits(rest: string[]): Promise<void> {
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(unitsUsage);
    return;
  }
  if (rest[0] === "done") {
    rejectUnexpectedArg(rest[2]);
  } else if (rest[0] === "list") {
    rejectUnexpectedArg(rest[1]);
  }
  const wu = await readWorkUnits();
  if (!wu) {
    console.log("No work-units.json — run cursor-goal compile");
    return;
  }
  if (rest[0] === "done" && rest[1]) {
    const root = projectRoot();
    const unit = findUnitById(wu.units, rest[1]);
    if (!unit) {
      console.error(`Unknown work unit: ${rest[1]}`);
      process.exit(1);
    }
    const evidence = await checkUnitCompletionEvidence(root, unit);
    if (!evidence.ok) {
      console.error(evidence.reason ?? `Unit ${unit.id} has no acceptable evidence`);
      process.exit(1);
    }
    const ok = await markUnitDone(unit.id, root);
    if (!ok) {
      console.error(`Unable to mark unit done: ${unit.id}`);
      process.exit(1);
    }
    console.log(`unit ${unit.id} marked done`);
  } else if (rest[0] === "list" || !rest[0]) {
    for (const u of wu.units) {
      console.log(`${u.id}\t${u.status}\t${u.title}`);
    }
    const open = pendingUnits(wu.units);
    if (open.length) console.log(`\n${open.length} unit(s) not done`);
  } else {
    console.error(unitsUsage);
    process.exit(1);
  }
}
