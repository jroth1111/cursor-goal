import { existsSync } from "node:fs";
import path from "node:path";
import { atomicWriteJson, goalDir, projectRoot, readJson } from "./paths.js";

export type GovernanceMode = "auto" | "chat" | "governed";
export type SessionMode = "chat" | "governed";
export type WritePolicy = "advisory" | "deny_out_of_scope";

export type GovernanceConfig = {
  default_mode: GovernanceMode;
  /** When true, governed beforeSubmitPrompt blocks missing GOAL / stale compile (I200). */
  governed_prompt_block?: boolean;
  /** When true, stop may queue Cursor followup_message user turns. Default is false. */
  stop_followup?: boolean;
  /** Primary-agent write policy. Default is advisory/fail-open. */
  write_policy?: WritePolicy;
};

export type SessionModeFile = {
  mode: SessionMode;
  /** Authoritative mode after governance reconciliation. */
  effective_mode?: SessionMode;
  source: "cli" | "triage";
  interaction_mode_hint?: "chat" | "delivery";
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

function parseWritePolicy(value: unknown): WritePolicy | null {
  if (value === "advisory" || value === "deny_out_of_scope") return value;
  return null;
}

function modeFromEnv(): GovernanceMode | null {
  const raw = process.env.CURSOR_GOAL_DEFAULT_MODE?.trim();
  return raw ? parseMode(raw) : null;
}

function boolFromEnv(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return null;
}

export async function readGovernanceConfig(root?: string): Promise<GovernanceConfig> {
  const fromEnv = modeFromEnv();
  const file = configPath(root);
  const raw = existsSync(file)
    ? await readJson<{
        default_mode?: unknown;
        governed_prompt_block?: unknown;
        stop_followup?: unknown;
        write_policy?: unknown;
      }>(file)
    : null;
  const mode = parseMode(raw?.default_mode);
  const envWritePolicy = parseWritePolicy(
    process.env.CURSOR_GOAL_WRITE_POLICY?.trim(),
  );
  const writePolicy = envWritePolicy ?? parseWritePolicy(raw?.write_policy);
  return {
    default_mode: fromEnv ?? mode ?? DEFAULT_CONFIG.default_mode,
    ...(raw?.governed_prompt_block === true ? { governed_prompt_block: true } : {}),
    ...(boolFromEnv("CURSOR_GOAL_STOP_FOLLOWUP") ?? raw?.stop_followup === true
      ? { stop_followup: true }
      : {}),
    ...(writePolicy && writePolicy !== "advisory" ? { write_policy: writePolicy } : {}),
  };
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
  const effective =
    raw.effective_mode === "chat" || raw.effective_mode === "governed"
      ? raw.effective_mode
      : raw.mode;
  return { ...raw, effective_mode: effective };
}

export async function writeSessionMode(
  root: string,
  mode: SessionMode,
  source: SessionModeFile["source"],
  interactionModeHint?: SessionModeFile["interaction_mode_hint"],
): Promise<void> {
  const effectiveHint = interactionModeHint ?? (mode === "governed" ? "delivery" : "chat");
  await atomicWriteJson(sessionModePath(root), {
    mode,
    effective_mode: mode,
    source,
    interaction_mode_hint: effectiveHint,
    updated_at: new Date().toISOString(),
  });
}

export async function isGovernedPromptBlock(root?: string): Promise<boolean> {
  const env = process.env.CURSOR_GOAL_GOVERNED_PROMPT_BLOCK?.trim();
  if (env === "1" || env === "true" || env === "yes") return true;
  const config = await readGovernanceConfig(root);
  return config.governed_prompt_block === true;
}

export async function readWritePolicy(root?: string): Promise<WritePolicy> {
  const config = await readGovernanceConfig(root);
  return config.write_policy ?? "advisory";
}

export async function shouldQueueStopFollowup(root?: string): Promise<boolean> {
  const env = boolFromEnv("CURSOR_GOAL_STOP_FOLLOWUP");
  if (env !== null) return env;
  const config = await readGovernanceConfig(root);
  return config.stop_followup === true;
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
