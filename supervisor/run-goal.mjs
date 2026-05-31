#!/usr/bin/env node
/**
 * Optional Ring-3 supervisor — NOT loaded by hooks.
 * Spawns cursor-agent with --print --trust and polls passports.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildUnitTaskPrompt } from "./unit-prompt.mjs";

const supervisorBooleanOptions = new Set([
  "--dry-run",
  "--interactive",
  "--dispatch-units",
  "--parent-only",
  "--units-only",
]);

export function buildAgentArgs(prompt, interactive = false) {
  if (interactive) return [];
  return ["--print", "--trust", "--force", prompt];
}

function rejectUnsupportedSupervisorArgs(args) {
  const promptIdx = args.indexOf("--prompt");
  const optionArgs = promptIdx >= 0 ? args.slice(0, promptIdx) : args;
  for (const arg of optionArgs) {
    if (supervisorBooleanOptions.has(arg)) continue;
    if (/^--wall-(min|sec)=/.test(arg)) continue;
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    throw new Error(`Unexpected argument: ${arg}`);
  }
}

function wallValue(args, option, defaultValue) {
  const prefix = `${option}=`;
  const arg = args.find((a) => a.startsWith(prefix));
  if (!arg) return defaultValue;
  const raw = arg.slice(prefix.length);
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value for ${option}: ${raw}`);
  }
  return value;
}

export function parseSupervisorArgs(argv) {
  const args = argv.slice(2);
  rejectUnsupportedSupervisorArgs(args);
  const promptIdx = args.indexOf("--prompt");
  const optionArgs = promptIdx >= 0 ? args.slice(0, promptIdx) : args;
  const promptArgs = promptIdx >= 0 ? args.slice(promptIdx + 1) : [];
  return {
    dryRun: optionArgs.includes("--dry-run"),
    interactive: optionArgs.includes("--interactive"),
    dispatchUnits: optionArgs.includes("--dispatch-units"),
    parentOnly: optionArgs.includes("--parent-only"),
    unitsOnly: optionArgs.includes("--units-only"),
    wallMin: wallValue(optionArgs, "--wall-min", 120),
    wallSec: wallValue(optionArgs, "--wall-sec", 0),
    prompt: promptIdx >= 0 ? promptArgs.join(" ") : "Work toward GOAL.md until RELEASE.",
  };
}

export { buildUnitTaskPrompt };

function cursorHome() {
  return process.env.CURSOR_HOME ?? path.join(os.homedir(), ".cursor");
}

function resolveRuntime(root) {
  if (
    process.env.CURSOR_GOAL_RUNTIME &&
    existsSync(path.join(process.env.CURSOR_GOAL_RUNTIME, "dist/hook-stop.mjs"))
  ) {
    return process.env.CURSOR_GOAL_RUNTIME;
  }
  const globalRt = path.join(cursorHome(), "cursor-goal-runtime");
  if (existsSync(path.join(globalRt, "dist/hook-stop.mjs"))) return globalRt;
  for (const p of [
    "packages/cursor-goal-runtime",
    "node_modules/@cursor-goal/runtime",
  ]) {
    const abs = path.join(root, p);
    if (existsSync(path.join(abs, "dist/hook-stop.mjs"))) return abs;
  }
  return null;
}

function coreInstalled(root) {
  if (existsSync(path.join(root, ".cursor/hooks/goal-stop.sh"))) return true;
  return existsSync(path.join(cursorHome(), "hooks/goal-stop.sh"));
}

async function ensureCore(root) {
  if (coreInstalled(root)) return;
  console.error(`cursor-goal hooks not installed. Run:
  npm run install:global
  # or per-repo: bash core/install.sh --local-hooks
`);
  process.exit(1);
}

async function pollUntil(done, timeoutMs, wallLabel) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (done.check()) {
      done.finish();
      return;
    }
    await new Promise((r) => setTimeout(r, Math.min(5000, timeoutMs)));
  }
  await writeFile(done.pausedPath, "", "utf8");
  console.error(`Wall clock ${wallLabel} exceeded — wrote .cursor/goal/PAUSED`);
  done.finish();
}

async function readWorkUnits(root) {
  const p = path.join(root, ".cursor/goal/work-units.json");
  if (!existsSync(p)) return [];
  const raw = JSON.parse(await readFile(p, "utf8"));
  return raw.units ?? [];
}

async function readDispatchQueue(root) {
  const p = path.join(root, ".cursor/goal/dispatch-queue.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}

export async function shouldAutoDispatchUnits(root, { dispatchUnits, parentOnly }) {
  if (parentOnly) return false;
  if (dispatchUnits) return true;
  const units = await readWorkUnits(root);
  const open = units.filter((u) => u.status !== "done");
  return open.length >= 1;
}

async function spawnAgent(agent, args, root, rt) {
  return new Promise((resolve, reject) => {
    const child = spawn(agent, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...(rt ? { CURSOR_GOAL_RUNTIME: rt } : {}) },
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
}

async function waitForUnitDone(root, unitId, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const units = await readWorkUnits(root);
    const u = units.find((x) => x.id === unitId);
    if (u?.status === "done") return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function dispatchOpenUnits(root, rt, agent, dryRun) {
  const units = await readWorkUnits(root);
  const byId = new Map(units.map((u) => [u.id, u]));
  const queue = await readDispatchQueue(root);

  const toDispatch = [];
  if (queue?.items?.length) {
    for (const item of queue.items) {
      const unit = byId.get(item.unit_id);
      if (unit && unit.status !== "done") toDispatch.push(unit);
    }
  } else {
    toDispatch.push(...units.filter((u) => u.status !== "done"));
  }

  for (const unit of toDispatch) {
    const prompt = buildUnitTaskPrompt(unit);
    const args = buildAgentArgs(prompt);
    console.log("Dispatch unit:", unit.id);
    if (dryRun) {
      console.log("Would run:", agent, args.join(" "));
      continue;
    }
    await spawnAgent(agent, args, root, rt);
    const done = await waitForUnitDone(root, unit.id);
    if (!done) {
      console.warn(`Unit ${unit.id} not done after wait — stopping dispatch chain`);
      break;
    }
  }
}

export async function main(argv = process.argv) {
  const { dryRun, interactive, dispatchUnits, parentOnly, unitsOnly, wallMin, wallSec, prompt } =
    parseSupervisorArgs(argv);
  const root = process.cwd();
  const passports = path.join(root, ".cursor/goal/passports");
  const release = path.join(passports, "RELEASE.json");
  const disposition = path.join(passports, "DISPOSITION.json");
  const paused = path.join(root, ".cursor/goal/PAUSED");

  await ensureCore(root);
  await mkdir(passports, { recursive: true });

  if (existsSync(paused)) {
    console.error("Plan paused (.cursor/goal/PAUSED) — run: cursor-goal resume");
    process.exit(2);
  }
  if (existsSync(disposition)) {
    console.error("Disposition active — resolve .cursor/goal/passports/DISPOSITION.json before supervisor run");
    process.exit(2);
  }

  const rt = resolveRuntime(root);
  console.log("Supervisor:", {
    core: true,
    runtime: rt ?? "minimal",
    wallMin,
    wallSec,
    dryRun,
    interactive,
    dispatchUnits,
    parentOnly,
  });

  const agent = process.env.CURSOR_AGENT_BIN ?? "cursor-agent";

  const autoDispatch = await shouldAutoDispatchUnits(root, { dispatchUnits, parentOnly });
  if (autoDispatch || unitsOnly) {
    await dispatchOpenUnits(root, rt, agent, dryRun);
  }

  if (unitsOnly) {
    process.exit(0);
  }

  const parentPrompt =
    parentOnly || autoDispatch
      ? "All work units should be done. Integrate changes, run GOAL.md checks, finish toward RELEASE."
      : prompt;

  const agentArgs = buildAgentArgs(parentPrompt, interactive);

  if (dryRun) {
    console.log("Would run parent:", agent, agentArgs.join(" "));
    return;
  }

  if (!interactive) {
    const child = spawn(agent, agentArgs, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...(rt ? { CURSOR_GOAL_RUNTIME: rt } : {}) },
    });

    const timeoutMs = wallSec > 0 ? wallSec * 1000 : wallMin * 60 * 1000;
    const wallLabel = wallSec > 0 ? `${wallSec}s` : `${wallMin}m`;

    await new Promise((resolve) => {
      pollUntil(
        {
          check: () => existsSync(release) || existsSync(disposition) || existsSync(paused),
          finish: () => {
            if (!child.killed) child.kill("SIGTERM");
            resolve();
          },
          pausedPath: paused,
        },
        timeoutMs,
        wallLabel,
      );
    });
  }

  const wuPath = path.join(root, ".cursor/goal/work-units.json");
  if (existsSync(wuPath)) {
    try {
      const wu = JSON.parse(await readFile(wuPath, "utf8"));
      const open = (wu.units ?? []).filter((u) => u.status !== "done");
      if (open.length) console.log("Open work units:", open.map((u) => u.id).join(", "));
    } catch {
      /* ignore */
    }
  }

  if (existsSync(release)) {
    console.log("RELEASE:", release);
    process.exit(0);
  }
  if (existsSync(disposition)) {
    console.log("DISPOSITION:", disposition);
    process.exit(2);
  }
  process.exit(1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
const self = path.resolve(fileURLToPath(import.meta.url));
if (entry === self) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
