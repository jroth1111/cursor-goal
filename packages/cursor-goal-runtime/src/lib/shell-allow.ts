import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ShellPolicyRule = {
  id: string;
  js: string;
  flags?: string;
  also_match?: string;
  also_match_any?: string[];
};

type ShellPolicyFile = {
  version: number;
  rules: ShellPolicyRule[];
  deny_fixtures?: string[];
};

const DEFAULT_SHELL_POLICY: ShellPolicyFile = {
  version: 1,
  rules: [
    { id: "drop_database", js: "\\bdrop\\s+database\\b", flags: "i" },
    {
      id: "force_git_push",
      js: "\\bgit\\b[\\s\\S]*\\bpush\\b",
      flags: "i",
      also_match: "(^|[\\s;&|])(-f\\b|--force([=\\s]|$)|--force-with-lease([=\\s]|$)|\\+[^\\s;&|]+)",
    },
    {
      id: "recursive_rm",
      js: "(^|[\\s;&|])rm([\\s;&|]|$)",
      flags: "i",
      also_match_any: [
        "(^|[\\s;&|])-[a-z]*r[a-z]*f[a-z]*(?=$|[\\s;&|])",
        "(^|[\\s;&|])-[a-z]*f[a-z]*r[a-z]*(?=$|[\\s;&|])",
        "(^|[\\s;&|])(-[a-z]*r[a-z]*|--recursive)(?=$|[\\s;&|])[\\s\\S]*(^|[\\s;&|])(-[a-z]*f[a-z]*|--force)(?=$|[\\s;&|])",
        "(^|[\\s;&|])(-[a-z]*f[a-z]*|--force)(?=$|[\\s;&|])[\\s\\S]*(^|[\\s;&|])(-[a-z]*r[a-z]*|--recursive)(?=$|[\\s;&|])",
      ],
    },
  ],
  deny_fixtures: [
    "rm -rf /tmp/x",
    "rm -r -f /tmp/x",
    "rm --recursive --force /tmp/x",
    "git push -f origin main",
    "git push --force-with-lease origin main",
    "git push origin +main",
    "DROP DATABASE prod",
  ],
};

let cachedPolicy: ShellPolicyFile | null | undefined;

function resolvePolicyPath(): string | null {
  const configured = process.env.CURSOR_GOAL_SHELL_POLICY_PATH?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  const candidates = [
    fileURLToPath(
      new URL("../../../../core/policy/destructive-shell.json", import.meta.url),
    ),
    fileURLToPath(
      new URL("../../../../../core/policy/destructive-shell.json", import.meta.url),
    ),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadShellPolicy(): ShellPolicyFile {
  if (cachedPolicy !== undefined) return cachedPolicy ?? DEFAULT_SHELL_POLICY;
  const policyPath = resolvePolicyPath();
  if (!policyPath) {
    cachedPolicy = DEFAULT_SHELL_POLICY;
    return cachedPolicy;
  }
  try {
    cachedPolicy = JSON.parse(readFileSync(policyPath, "utf8")) as ShellPolicyFile;
  } catch {
    cachedPolicy = DEFAULT_SHELL_POLICY;
  }
  return cachedPolicy;
}

function ruleMatches(cmd: string, rule: ShellPolicyRule): boolean {
  const flags = rule.flags ?? "i";
  if (!new RegExp(rule.js, flags).test(cmd)) return false;
  if (rule.also_match && !new RegExp(rule.also_match, flags).test(cmd)) return false;
  if (rule.also_match_any?.length) {
    if (!rule.also_match_any.some((p) => new RegExp(p, flags).test(cmd))) return false;
  }
  return true;
}

export function shellCommandAllowed(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (!trimmed) return true;
  const policy = loadShellPolicy();
  return !policy.rules.some((rule) => ruleMatches(trimmed, rule));
}

export type ShellGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Shared shell gate for beforeShellExecution.
 * preToolUse does not gate shell — see hooks.json matcher on preToolUse.
 */
export async function checkShellGate(
  cmd: string,
  _root?: string,
): Promise<ShellGateResult> {
  const trimmed = cmd.trim();
  if (!trimmed) return { allowed: true };

  if (!shellCommandAllowed(trimmed)) {
    return {
      allowed: false,
      reason: "Destructive command blocked by cursor-goal-runtime.",
    };
  }

  return { allowed: true };
}

export function shellPolicyDenyFixtures(): string[] {
  return loadShellPolicy().deny_fixtures ?? [];
}
