import { existsSync, readdirSync } from "node:fs";
import { mkdir, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { withGoalDirLock } from "./goal-dir-lock.js";
import { goalDir, passportsDir, projectRoot, readJson } from "./paths.js";
import { agentRuntimeStatePath } from "./agent-runtime-state.js";

export type AgentDispositionFile = {
  status: "DISPOSITION";
  recoverable: boolean;
  failed: string[];
  loop_count: number;
  conversation_id?: string;
  agent_id: string;
  at: string;
  summary?: string;
  mode?: string;
  waive_work_units?: boolean;
};

export function agentDispositionPath(root: string, agentId: string): string {
  return path.join(goalDir(root), "agents", agentId, "DISPOSITION.json");
}

export function agentDispositionMdPath(root: string, agentId: string): string {
  return path.join(goalDir(root), "agents", agentId, "DISPOSITION.md");
}

/** Legacy repo-wide manifest (lists agents in disposition for operator tools). */
export function repoDispositionManifestPath(root?: string): string {
  return path.join(passportsDir(root), "DISPOSITION.json");
}

export function sessionEndMarkerPath(root?: string): string {
  return path.join(passportsDir(root), "SESSION_END.json");
}

export async function hasAgentDisposition(root: string, agentId: string): Promise<boolean> {
  return existsSync(agentDispositionPath(root, agentId));
}

export async function readAgentDisposition(
  root: string,
  agentId: string,
): Promise<AgentDispositionFile | null> {
  const p = agentDispositionPath(root, agentId);
  if (!existsSync(p)) return null;
  try {
    return await readJson<AgentDispositionFile>(p);
  } catch {
    return null;
  }
}

async function writeRepoDispositionManifestUnlocked(root: string): Promise<void> {
  const agents = listAgentsInDisposition(root);
  const manifestPath = repoDispositionManifestPath(root);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const tmp = `${manifestPath}.tmp.${process.pid}`;
  if (agents.length === 0) {
    await unlink(manifestPath).catch(() => undefined);
    await unlink(path.join(passportsDir(root), "DISPOSITION.md")).catch(() => undefined);
    return;
  }
  await writeFile(
    tmp,
    `${JSON.stringify(
      {
        status: "DISPOSITION",
        agents_in_disposition: agents,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(tmp, manifestPath);
}

/** Caller must hold goal-dir lock when invoked from locked sections. */
export async function writeAgentDispositionUnlocked(
  root: string,
  agentId: string,
  data: AgentDispositionFile,
  mdBody?: string,
): Promise<void> {
  const jsonPath = agentDispositionPath(root, agentId);
  await mkdir(path.dirname(jsonPath), { recursive: true });
  const tmp = `${jsonPath}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, jsonPath);

  if (mdBody) {
    const mdPath = agentDispositionMdPath(root, agentId);
    const mdTmp = `${mdPath}.tmp.${process.pid}`;
    await writeFile(mdTmp, mdBody, "utf8");
    await rename(mdTmp, mdPath);
  }

  await writeRepoDispositionManifestUnlocked(root);
}

export async function writeAgentDisposition(
  root: string,
  agentId: string,
  data: AgentDispositionFile,
  mdBody?: string,
): Promise<void> {
  await withGoalDirLock(root, async () => {
    await writeAgentDispositionUnlocked(root, agentId, data, mdBody);
  });
}

export function listAgentsInDisposition(root: string): string[] {
  const dir = path.join(goalDir(root), "agents");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (existsSync(agentDispositionPath(root, name))) out.push(name);
  }
  return out;
}

export function countAgentsInDisposition(root?: string): number {
  const r = root ?? projectRoot();
  return listAgentsInDisposition(r).length;
}

/** Caller must hold goal-dir lock when invoked from locked sections. */
export async function clearAgentDispositionUnlocked(
  root: string,
  agentId: string,
): Promise<void> {
  const jsonPath = agentDispositionPath(root, agentId);
  const mdPath = agentDispositionMdPath(root, agentId);
  await unlink(jsonPath).catch(() => undefined);
  await unlink(mdPath).catch(() => undefined);
  await writeRepoDispositionManifestUnlocked(root);
}

export async function clearAgentDisposition(root: string, agentId: string): Promise<void> {
  await withGoalDirLock(root, async () => {
    await clearAgentDispositionUnlocked(root, agentId);
  });
}

export async function clearAllAgentDispositions(root: string): Promise<void> {
  await withGoalDirLock(root, async () => {
    for (const agentId of listAgentsInDisposition(root)) {
      await clearAgentDispositionUnlocked(root, agentId);
    }
    await unlink(repoDispositionManifestPath(root)).catch(() => undefined);
    await unlink(path.join(passportsDir(root), "DISPOSITION.md")).catch(() => undefined);
  });
}

/** True when this conversation must not submit (blocked handoff or disposition). */
export async function isAgentSubmitBlocked(root: string, agentId: string): Promise<boolean> {
  if (existsSync(agentDispositionPath(root, agentId))) return true;
  const statePath = agentRuntimeStatePath(root, agentId);
  if (!existsSync(statePath)) return false;
  try {
    const state = await readJson<{ blocked?: boolean }>(statePath);
    return state?.blocked === true;
  } catch {
    return false;
  }
}

export async function dispositionWaivesUnits(
  root: string,
  agentId?: string,
): Promise<boolean> {
  if (agentId) {
    const d = await readAgentDisposition(root, agentId);
    return d?.waive_work_units === true;
  }
  for (const id of listAgentsInDisposition(root)) {
    const d = await readAgentDisposition(root, id);
    if (d?.waive_work_units === true) return true;
  }
  return false;
}
