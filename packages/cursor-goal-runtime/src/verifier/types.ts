import type { ParsedGoal } from "../lib/parse-goal-md.js";
import type { CheckProfile, CheckResult } from "../lib/run-checks.js";

export type StopInput = {
  status?: string;
  loop_count?: number;
  conversation_id?: string;
  transcript_path?: string | null;
  /** When true, Cursor is re-invoking stop from a prior followup_message — avoid infinite loops. */
  stop_hook_active?: boolean;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

export type PipelineOptions = {
  dryRun?: boolean;
};

export type VerifyKind = "idle" | "release" | "continue" | "disposition";

export type VerifierContext = {
  root: string;
  input: StopInput;
  parsed: ParsedGoal;
  loopLimit: number;
  loopCount: number;
  failures: string[];
  checkResults: CheckResult[];
  currentTree: string;
  phaseBlocked?: boolean;
  unitsBlocked?: boolean;
  phase?: import("../trajectory/fsm.js").Phase;
  /** Prefer this over generic followup when set by invalidators. */
  followupMessage?: string;
  advisoryWarnings?: string[];
  checkProfile?: CheckProfile;
  checkTiers?: Record<string, "fast" | "full">;
};

export type LevelResult = {
  halt?: boolean;
  kind?: VerifyKind;
  message?: string;
};
