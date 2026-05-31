import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { goalDir, readJson } from "./paths.js";
import { listAgentsInDisposition } from "./disposition.js";
import { readLoopLimit } from "./loop-limit.js";
import type {
  RuntimeStateCheckFail,
  RuntimeStateFile,
  RuntimeStateMode,
  RuntimeStateNextAction,
} from "./runtime-state.js";

export type AgentIdSource = {
  conversation_id?: string;
};

export function sanitizeAgentId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return cleaned || "default";
}

export function resolveAgentId(input?: AgentIdSource | string | null): string {
  if (typeof input === "string") return sanitizeAgentId(input);
  const fromInput = input?.conversation_id;
  if (typeof fromInput === "string" && fromInput.trim()) {
    return sanitizeAgentId(fromInput.trim());
  }
  const fromEnv = process.env.CURSOR_CONVERSATION_ID;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return sanitizeAgentId(fromEnv.trim());
  }
  return "default";
}

export function agentRuntimeStatePath(root: string, agentId: string): string {
  return path.join(goalDir(root), "agents", agentId, "runtime-state.json");
}

export function agentsDir(root?: string): string {
  return path.join(goalDir(root), "agents");
}

export async function readAgentRuntimeState(
  root: string,
  agentId: string,
): Promise<RuntimeStateFile | null> {
  const p = agentRuntimeStatePath(root, agentId);
  if (!existsSync(p)) return null;
  try {
    return await readJson<RuntimeStateFile>(p);
  } catch {
    return null;
  }
}

export async function writeAgentRuntimeState(
  root: string,
  agentId: string,
  state: RuntimeStateFile,
): Promise<void> {
  const file = agentRuntimeStatePath(root, agentId);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

export async function readAgentLoopCount(root: string, agentId: string): Promise<number> {
  const state = await readAgentRuntimeState(root, agentId);
  if (typeof state?.loop_count === "number" && state.loop_count >= 0) {
    return state.loop_count;
  }
  return 0;
}

export async function clearAgentBlockedState(
  root: string,
  agentId: string,
  partial?: { loopCount?: number; phase?: string },
): Promise<void> {
  const limit = await readLoopLimit(root);
  const existing = (await readAgentRuntimeState(root, agentId)) ?? defaultAgentState(limit);
  await writeAgentRuntimeState(root, agentId, {
    ...existing,
    loop_count: partial?.loopCount ?? existing.loop_count,
    loop_limit: limit,
    phase: partial?.phase ?? existing.phase,
    blocked: false,
    blockers: [],
    next_action: null,
    last_check_fail: null,
    updated_at: new Date().toISOString(),
  });
}

/** Clear blocked handoff fields on every agent; preserves each agent loop_count. */
export async function clearAllAgentsBlockedState(root: string): Promise<void> {
  const dir = agentsDir(root);
  if (!existsSync(dir)) return;
  const now = new Date().toISOString();
  for (const name of readdirSync(dir)) {
    const agentPath = path.join(dir, name, "runtime-state.json");
    if (!existsSync(agentPath)) continue;
    try {
      const state = await readJson<RuntimeStateFile>(agentPath);
      if (!state) continue;
      await writeAgentRuntimeState(root, name, {
        ...state,
        blocked: false,
        blockers: [],
        next_action: null,
        last_check_fail: null,
        updated_at: now,
      });
    } catch {
      /* skip corrupt agent files */
    }
  }
}

/** Agents that cannot submit: blocked handoff and/or per-agent disposition. */
export function countSubmitBlockedAgents(root: string): number {
  const ids = new Set<string>();
  for (const id of listAgentsInDisposition(root)) ids.add(id);
  const dir = agentsDir(root);
  if (!existsSync(dir)) return ids.size;
  for (const name of readdirSync(dir)) {
    const agentPath = path.join(dir, name, "runtime-state.json");
    if (!existsSync(agentPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(agentPath, "utf8")) as RuntimeStateFile;
      if (raw?.blocked === true) ids.add(name);
    } catch {
      /* skip */
    }
  }
  return ids.size;
}

function defaultAgentState(limit: number): RuntimeStateFile {
  return {
    mode: "runtime",
    loop_count: 0,
    loop_limit: limit,
    phase: "DISCOVERY",
    blocked: false,
    blockers: [],
    next_action: null,
    last_check_fail: null,
    updated_at: new Date().toISOString(),
  };
}

export type { RuntimeStateNextAction, RuntimeStateCheckFail, RuntimeStateMode };
