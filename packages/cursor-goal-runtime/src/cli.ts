#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { compileGoalV2 } from "./compile/compile-v2.js";
import { runStopVerifier } from "./lib/verify.js";
import { goalDir, goalMd, projectRoot, writeJson } from "./lib/paths.js";
import { advancePhase, completeDiscovery } from "./trajectory/fsm.js";
import { findUnitById, readWorkUnits, markUnitDone, pendingUnits } from "./lib/work-units.js";
import { checkUnitCompletionEvidence } from "./lib/unit-evidence.js";
import { buildOperatorNextAction, buildOperatorSnapshot, formatOperatorStatus } from "./lib/operator.js";
import { formatDispatchCli, runSupervisorDispatch } from "./lib/dispatch-cli.js";
import { runDoctor } from "./lib/doctor.js";
import {
  clearSessionMode,
  readGovernanceConfig,
  readSessionMode,
  writeGovernanceConfig,
  writeSessionMode,
  type GovernanceMode,
} from "./lib/governance-config.js";
import { formatModeStatus } from "./lib/prompt-triage.js";
function operatorOptionsFromArgv(args: string[]): { conversation_id?: string } | undefined {
  const i = args.indexOf("--conversation");
  if (i >= 0 && args[i + 1]) return { conversation_id: args[i + 1] };
  const env = process.env.CURSOR_CONVERSATION_ID;
  if (typeof env === "string" && env.trim()) return { conversation_id: env.trim() };
  return undefined;
}
import { copyFile, mkdir } from "node:fs/promises";
import { goalTemplatePath } from "./lib/template.js";

const [, , cmd, ...rest] = process.argv;

const unitsUsage = "Usage: cursor-goal units list | cursor-goal units done <id>";

async function seedGoal(): Promise<void> {
  const root = projectRoot();
  const template = goalTemplatePath();
  const dest = goalMd(root);
  if (!existsSync(dest)) {
    await copyFile(template, dest);
    console.log(`Created ${dest}`);
  }
  await mkdir(goalDir(root), { recursive: true });
}

async function main(): Promise<void> {
  switch (cmd) {
    case "init":
      await seedGoal();
      await compileGoalV2();
      console.log("Initialized GOAL.md and compiled artifacts");
      break;
    case "compile":
      await compileGoalV2();
      console.log("Compiled GOAL.md → .cursor/goal/");
      break;
    case "verify": {
      const r = await runStopVerifier({ status: "completed", loop_count: 0 });
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.kind === "release" ? 0 : 1);
    }
    case "next": {
      if (rest.includes("--json")) {
        const snap = await buildOperatorSnapshot(projectRoot(), operatorOptionsFromArgv(rest));
        if ("error" in snap) {
          console.error(snap.error);
          process.exit(1);
        }
        console.log(JSON.stringify(snap, null, 2));
        process.exit(0);
      }
      console.log(await buildOperatorNextAction(projectRoot(), operatorOptionsFromArgv(rest)));
      process.exit(0);
    }
    case "dispatch": {
      const dryRun = rest.includes("--dry-run");
      const run = rest.includes("--run");
      if (run || dryRun) {
        const r = runSupervisorDispatch(projectRoot(), { dryRun, unitsOnly: true });
        process.stdout.write(r.stdout);
        process.stderr.write(r.stderr);
        process.exit(r.status);
      }
      console.log(await formatDispatchCli());
      process.exit(0);
    }
    case "doctor": {
      const issues = await runDoctor();
      for (const i of issues) console.log(`${i.level}: ${i.message}`);
      process.exit(issues.some((i) => i.level === "error") ? 1 : 0);
    }
    case "pause": {
      await writeFile(path.join(goalDir(), "PAUSED"), "", "utf8");
      console.log("Paused");
      break;
    }
    case "resume": {
      const p = path.join(goalDir(), "PAUSED");
      if (existsSync(p)) await unlink(p);
      console.log("Resumed");
      break;
    }
    case "phase": {
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
      break;
    }
    case "discovery": {
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
      break;
    }
    case "units": {
      if (rest.includes("--help") || rest.includes("-h")) {
        console.log(unitsUsage);
        break;
      }
      const wu = await readWorkUnits();
      if (!wu) {
        console.log("No work-units.json — run cursor-goal compile");
        break;
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
      break;
    }
    case "status": {
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
      break;
    }
    case "mode": {
      const root = projectRoot();
      const sub = rest[0];
      if (!sub) {
        const config = await readGovernanceConfig(root);
        const session = await readSessionMode(root);
        console.log(formatModeStatus(config, session));
        break;
      }
      if (sub === "auto") {
        await clearSessionMode(root);
        console.log("Session mode cleared; using config default_mode");
        break;
      }
      if (sub === "chat" || sub === "governed") {
        await writeSessionMode(root, sub, "cli");
        if (sub === "governed") {
          await seedGoal();
          await compileGoalV2(root);
          console.log("Session mode: governed (GOAL initialized if missing)");
        } else {
          console.log("Session mode: chat");
        }
        break;
      }
      if (sub === "set" && rest[1]) {
        const mode = rest[1] as GovernanceMode;
        if (mode !== "auto" && mode !== "chat" && mode !== "governed") {
          console.error("Usage: cursor-goal mode set auto|chat|governed");
          process.exit(1);
        }
        await writeGovernanceConfig(root, { default_mode: mode });
        console.log(`default_mode=${mode}`);
        break;
      }
      console.error("Usage: cursor-goal mode [chat|governed|auto|set auto|chat|governed]");
      process.exit(1);
    }
    default:
      console.log(`cursor-goal — governance runtime for cursor-goal

Usage:
  cursor-goal init
  cursor-goal compile
  cursor-goal verify
  cursor-goal next [--json]
  cursor-goal dispatch [--dry-run|--run]
  cursor-goal doctor
  cursor-goal pause|resume
  cursor-goal mode [chat|governed|auto|set auto|chat|governed]
  cursor-goal phase advance IMPLEMENT
  cursor-goal discovery complete [notes]
  cursor-goal units list
  cursor-goal units done <id>
  cursor-goal status [--json]
`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
