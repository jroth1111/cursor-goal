import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatDispatchInstruction, resolveDispatchHead } from "./dispatch-head.js";
import { goalMd, fileMtimeMs, passportsDir } from "./paths.js";
import { dispatchQueuePath } from "./dispatch-queue.js";
import { runtimeStatePath } from "./runtime-state.js";

export function runSupervisorDispatch(
  root: string,
  flags: { dryRun?: boolean; unitsOnly?: boolean },
): { status: number; stdout: string; stderr: string } {
  const supervisor = fileURLToPath(
    new URL("../../../../supervisor/run-goal.mjs", import.meta.url),
  );
  const args = [supervisor];
  if (flags.dryRun) args.push("--dry-run");
  if (flags.unitsOnly) args.push("--units-only");
  const r = spawnSync("node", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CURSOR_PROJECT_DIR: root },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

export async function invalidateRuntimeState(root: string): Promise<void> {
  const { withGoalDirLock } = await import("./goal-dir-lock.js");
  const { clearAllAgentsBlockedState } = await import("./agent-runtime-state.js");
  const { resetRepoBlockedStopTotalUnlocked } = await import("./goal-loop.js");
  const { rebuildRepoRuntimeSummaryUnlocked } = await import("./runtime-state.js");

  await withGoalDirLock(root, async () => {
    await clearInvalidatedLifecyclePassports(root);
    await clearAllAgentsBlockedState(root);
    await resetRepoBlockedStopTotalUnlocked(root);
    await rebuildRepoRuntimeSummaryUnlocked(root);
  });
}

async function clearInvalidatedLifecyclePassports(root: string): Promise<void> {
  const passports = passportsDir(root);
  await unlink(path.join(passports, "RELEASE.json")).catch(() => undefined);
  await unlink(path.join(passports, "RELEASE.md")).catch(() => undefined);
  await unlink(path.join(passports, "SESSION_END.json")).catch(() => undefined);
  await unlink(path.join(passports, "SESSION_END.md")).catch(() => undefined);
}

async function readManifestState(root: string): Promise<{
  compiledAt: string | null;
  malformed: boolean;
}> {
  const manifestPath = path.join(root, ".cursor/goal/manifest.json");
  if (!existsSync(manifestPath)) return { compiledAt: null, malformed: false };
  const { readJson } = await import("./paths.js");
  try {
    const m = await readJson<{ compiled_at?: string }>(manifestPath);
    return { compiledAt: m?.compiled_at ?? null, malformed: false };
  } catch {
    return { compiledAt: null, malformed: true };
  }
}

export async function readManifestCompiledAt(root: string): Promise<string | null> {
  return (await readManifestState(root)).compiledAt;
}

export async function isRuntimeStateStale(root: string): Promise<boolean> {
  const { readRepoRuntimeSummary } = await import("./runtime-state.js");
  const state = await readRepoRuntimeSummary(root);
  if (!state) return false;

  const updatedMs = Date.parse(state.updated_at);
  if (Number.isNaN(updatedMs)) return true;

  const manifest = await readManifestState(root);
  if (manifest.malformed) return true;
  const compiledAt = manifest.compiledAt;
  if (compiledAt) {
    const compiledMs = Date.parse(compiledAt);
    if (!Number.isNaN(compiledMs) && compiledMs > updatedMs) return true;
  }

  const goalMtime = await fileMtimeMs(goalMd(root));
  if (goalMtime !== null && goalMtime > updatedMs) return true;

  const wuMtime = await fileMtimeMs(path.join(root, ".cursor/goal/work-units.json"));
  if (wuMtime !== null && wuMtime > updatedMs) return true;

  const queueMtime = await fileMtimeMs(dispatchQueuePath(root));
  if (queueMtime !== null && queueMtime > updatedMs) return true;

  const trajMtime = await fileMtimeMs(path.join(root, ".cursor/goal/trajectory.json"));
  if (trajMtime !== null && trajMtime > updatedMs) return true;

  const proofMtime = await fileMtimeMs(path.join(root, ".cursor/goal/state.json"));
  if (proofMtime !== null && proofMtime > updatedMs) return true;

  return false;
}

export async function formatDispatchCli(root?: string): Promise<string> {
  const head = await resolveDispatchHead(root);
  if (!head) return "No open work units — run cursor-goal status";
  return formatDispatchInstruction(head);
}
