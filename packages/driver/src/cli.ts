#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { projectRoot } from "./lib/paths.js";
import { agentBin } from "./agent/runner.js";
import { runGoal } from "./driver/loop.js";
import { computeNext } from "./bridge/hook-next.js";
import { intake } from "./driver/intake.js";
import { decompose } from "./driver/decompose.js";
import { runGoalAcceptance } from "./checks/acceptance.js";
import { loadGraph, loadRun } from "./state/store.js";

function parseFlags(args: string[]): { flags: Record<string, string | boolean>; rest: string[] } {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < args.length && !args[i + 1].startsWith("--")) flags[a.slice(2)] = args[++i];
      else flags[a.slice(2)] = true;
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

async function cmdRun(flags: Record<string, string | boolean>, rest: string[]): Promise<number> {
  const root = projectRoot();
  const goalInput = rest.join(" ");
  const budgets: Record<string, number> = {};
  if (typeof flags["max-turns"] === "string") budgets.global_turns = Number(flags["max-turns"]);

  if (flags["dry-run"]) {
    const spec = await intake(goalInput, root);
    const dec = await decompose(spec, root);
    process.stdout.write(`${JSON.stringify({ spec, decompose: dec }, null, 2)}\n`);
    return 0;
  }

  const run = await runGoal({
    root,
    goalInput,
    model: typeof flags.model === "string" ? flags.model : null,
    budgets: Object.keys(budgets).length ? budgets : undefined,
  });
  process.stdout.write(
    `${JSON.stringify({ status: run.status, turns: run.global_turns, escalation: run.escalation_reason }, null, 2)}\n`,
  );
  return run.status === "done" ? 0 : run.status === "escalated" ? 2 : 1;
}

async function cmdNext(flags: Record<string, string | boolean>): Promise<number> {
  const root = projectRoot();
  const loopCount = typeof flags["loop-count"] === "string" ? Number(flags["loop-count"]) : 0;
  const result = await computeNext(root, Number.isFinite(loopCount) ? loopCount : 0);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

async function cmdStatus(): Promise<number> {
  const root = projectRoot();
  const run = await loadRun(root);
  const graph = await loadGraph(root);
  if (!run) {
    process.stdout.write("No driver run in this repo.\n");
    return 0;
  }
  const taskLines = (graph?.tasks ?? [])
    .map((t) => `  ${t.status === "done" ? "✓" : "○"} ${t.id} [${t.status}] ${t.title} (attempts ${t.attempts})`)
    .join("\n");
  process.stdout.write(
    `goal: ${run.goal_spec.goal_text}\nstatus: ${run.status}  turns: ${run.global_turns}/${run.budgets.global_turns}  tokens: ${run.consumed.tokens}\n` +
      (run.escalation_reason ? `escalation: ${run.escalation_reason}\n` : "") +
      `tasks:\n${taskLines}\n`,
  );
  return 0;
}

async function cmdVerify(): Promise<number> {
  const root = projectRoot();
  const run = await loadRun(root);
  if (!run) {
    process.stdout.write("No driver run; nothing to verify.\n");
    return 0;
  }
  const outcome = await runGoalAcceptance(root, run.goal_spec);
  if (!outcome.objective) {
    process.stdout.write("No goal-level acceptance checks defined.\n");
    return 0;
  }
  for (const r of outcome.results) {
    process.stdout.write(`  [${r.ok ? "PASS" : "FAIL"}] ${r.cmd}\n`);
  }
  return outcome.allPass ? 0 : 1;
}

function cmdDoctor(): number {
  const root = projectRoot();
  const bin = agentBin();
  let version = "unresolved";
  let agentOk = false;
  try {
    version = execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
    agentOk = true;
  } catch {
    /* unresolved */
  }
  const hooksJson = `${root}/.cursor/hooks.json`;
  const hooksInstalled = existsSync(hooksJson);
  process.stdout.write(
    `agent-driver doctor\n` +
      `  cursor-agent: ${agentOk ? `ok (${version})` : `NOT FOUND ('${bin}')`}\n` +
      `  project root: ${root}\n` +
      `  hooks.json: ${hooksInstalled ? "present" : "absent (safety net not installed)"}\n` +
      `  note: the driver owns its own checks and loop; hooks are a safety net, not a dependency.\n`,
  );
  return agentOk ? 0 : 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const { flags, rest } = parseFlags(argv.slice(1));
  let code = 0;
  switch (cmd) {
    case "run":
      code = await cmdRun(flags, rest);
      break;
    case "next":
      code = await cmdNext(flags);
      break;
    case "status":
      code = await cmdStatus();
      break;
    case "verify":
      code = await cmdVerify();
      break;
    case "doctor":
      code = cmdDoctor();
      break;
    default:
      process.stdout.write(
        "Usage: agent-driver <run|next|status|verify|doctor> [goal...]\n" +
          "  run [goal]         decompose and drive cursor-agent to the goal (flags: --max-turns N --model M --dry-run)\n" +
          "  next               print {followup_message?} for an interactive stop hook (flag: --loop-count N)\n" +
          "  status             show run + task graph\n" +
          "  verify             run goal-level acceptance checks\n" +
          "  doctor             check cursor-agent availability and hook install\n",
      );
      code = cmd ? 1 : 0;
  }
  process.exit(code);
}

main().catch((e) => {
  process.stderr.write(`agent-driver error: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
