import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { compileGoalV2 } from "../compile/compile-v2.js";
import { goalDir, goalMd, projectRoot, writeJson } from "../lib/paths.js";
import { advancePhase, completeDiscovery } from "../trajectory/fsm.js";
import { findUnitById, readWorkUnits, markUnitDone, pendingUnits } from "../lib/work-units.js";
import { checkUnitCompletionEvidence } from "../lib/unit-evidence.js";
import { lintGoalMd } from "../lib/goal-lint.js";
import { goalTemplatePath } from "../lib/template.js";
import { applyDetectedChecks } from "../lib/goal-detect.js";
import { startCompileWatch } from "../lib/compile-watch.js";

const unitsUsage = "Usage: cursor-goal units list | cursor-goal units done <id>";

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
  const doCompile = rest.includes("--compile");
  const doDetect = rest.includes("--detect");
  await seedGoal();
  if (doDetect) {
    const detected = await applyDetectedChecks(projectRoot());
    console.log(`Detected checks from ${detected.source}: ${detected.commands.join(", ")}`);
  }
  if (doCompile) {
    await compileGoalV2();
    console.log("Initialized GOAL.md and compiled artifacts");
  } else {
    console.log("Initialized GOAL.md — edit checks, then run: cursor-goal compile");
  }
}

export async function handleCompile(rest: string[]): Promise<void> {
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
    const to = (rest[1] ?? "IMPLEMENT") as Parameters<typeof advancePhase>[0];
    const r = await advancePhase(to);
    if (!r.ok) {
      console.error(r.error);
      process.exit(1);
    }
    console.log(`phase=${to}`);
  } else {
    const phase = sub ?? "IMPLEMENT";
    await writeJson(path.join(goalDir(), "trajectory.json"), { phase });
    console.log(`phase=${phase} (direct set)`);
  }
}

export async function handleDiscovery(rest: string[]): Promise<void> {
  if (rest[0] === "complete") {
    const planOnly = rest.includes("--plan-only");
    const notes =
      rest.filter((x) => x !== "--plan-only").slice(1).join(" ") || "discovery complete";
    await completeDiscovery(notes, undefined, { planOnly });
    console.log(
      planOnly
        ? "discovery completed; phase advanced to PLAN"
        : "discovery completed; phase advanced to IMPLEMENT",
    );
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
    console.log(unitsUsage);
  }
}
