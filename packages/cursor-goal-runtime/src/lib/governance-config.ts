import { existsSync } from "node:fs";
import path from "node:path";
import { atomicWriteJson, goalDir, projectRoot, readJson } from "./paths.js";

export type GovernanceMode = "auto" | "chat" | "governed";
export type SessionMode = "chat" | "governed";

export type GovernanceConfig = {
  default_mode: GovernanceMode;
};

export type SessionModeFile = {
  mode: SessionMode;
  source: "cli" | "triage";
  updated_at: string;
};

const DEFAULT_CONFIG: GovernanceConfig = { default_mode: "auto" };

function configPath(root?: string): string {
  return path.join(goalDir(root), "config.json");
}

function sessionModePath(root?: string): string {
  return path.join(goalDir(root), "session-mode.json");
}

function parseMode(value: unknown): GovernanceMode | null {
  if (value === "auto" || value === "chat" || value === "governed") return value;
  return null;
}

function modeFromEnv(): GovernanceMode | null {
  const raw = process.env.CURSOR_GOAL_DEFAULT_MODE?.trim();
  return raw ? parseMode(raw) : null;
}

export async function readGovernanceConfig(root?: string): Promise<GovernanceConfig> {
  const fromEnv = modeFromEnv();
  if (fromEnv) return { default_mode: fromEnv };

  const file = configPath(root);
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };

  const raw = await readJson<{ default_mode?: unknown }>(file);
  const mode = parseMode(raw?.default_mode);
  return { default_mode: mode ?? DEFAULT_CONFIG.default_mode };
}

export async function writeGovernanceConfig(
  root: string,
  config: GovernanceConfig,
): Promise<void> {
  await atomicWriteJson(configPath(root), config);
}

export async function readSessionMode(root?: string): Promise<SessionModeFile | null> {
  const raw = await readJson<SessionModeFile>(sessionModePath(root));
  if (!raw?.mode || (raw.mode !== "chat" && raw.mode !== "governed")) return null;
  return raw;
}

export async function writeSessionMode(
  root: string,
  mode: SessionMode,
  source: SessionModeFile["source"],
): Promise<void> {
  await atomicWriteJson(sessionModePath(root), {
    mode,
    source,
    updated_at: new Date().toISOString(),
  });
}

export async function clearSessionMode(root?: string): Promise<void> {
  const p = sessionModePath(root ?? projectRoot());
  if (existsSync(p)) {
    const { unlink } = await import("node:fs/promises");
    await unlink(p).catch(() => undefined);
  }
}

export function shouldAutoInitOnSessionStart(config: GovernanceConfig, session: SessionModeFile | null): boolean {
  if (process.env.CURSOR_GOAL_NO_AUTO_INIT === "1") return false;
  if (session?.mode === "governed") return true;
  if (session?.mode === "chat") return false;
  return config.default_mode === "governed";
}
