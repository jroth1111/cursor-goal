import type { ParsedGoal } from "../lib/parse-goal-md.js";
import type { CheckResult } from "../lib/run-checks.js";

export type StopInput = {
  status?: string;
  loop_count?: number;
  conversation_id?: string;
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
};

export type LevelResult = {
  halt?: boolean;
  kind?: VerifyKind;
  message?: string;
};
