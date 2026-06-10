import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isGoalArtifactPath } from "../lib/git.js";

/**
 * Integrity guards against the two failure modes a checks-pass gate can't catch on
 * its own: reward-hacking (making the checks pass by weakening verification rather
 * than doing the work) and scope creep (editing files outside the declared goal scope).
 * Both, when detected, block task completion and are fed back to the agent.
 */

function git(root: string, cmd: string): string {
  try {
    return execSync(cmd, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|specs)\/|(^|\/)(test_[^/]+|[^/]+[._-](test|spec|tests))\.[A-Za-z0-9]+$/i;

/** Tells that a turn defeated verification instead of satisfying it. */
const BYPASS: Array<[RegExp, string]> = [
  [/\|\|\s*true(\s|$|;|&)/, "appended '|| true' to swallow a command failure"],
  [/--pass-?[Ww]ith-?[Nn]o-?[Tt]ests/, "added --passWithNoTests"],
  [/\b(it|test|describe|context)\.skip\b|\bxit\s*\(|\bxdescribe\s*\(/, "skipped a test (.skip / xit)"],
  [/@(?:unittest\.)?skip|@?pytest\.mark\.skip|\.skipif\b/i, "skipped a Python test"],
  [/\bt\.Skip(?:Now)?\s*\(/, "skipped a Go test (t.Skip)"],
  [/#\[ignore\]/, "ignored a Rust test (#[ignore])"],
  [/\bassert\s+true\b|\bassertTrue\(\s*true\s*\)|expect\(\s*true\s*\)\.toBe\(\s*true\s*\)/i,
    "inserted a trivially-true assertion"],
];

type FileBlock = { file: string; added: string[] };

function parseDiffAddedLines(diff: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  let current: FileBlock | null = null;
  for (const line of diff.split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/);
    if (m) {
      current = { file: m[1], added: [] };
      blocks.push(current);
      continue;
    }
    if (current && line.startsWith("+") && !line.startsWith("+++")) {
      current.added.push(line.slice(1));
    }
  }
  return blocks;
}

/** Reward-hacking detection over the working tree vs HEAD, plus new untracked files. */
export function detectTamper(root: string): string[] {
  const issues: string[] = [];

  // Deleted tracked test files.
  for (const line of git(root, "git diff --name-status HEAD").split("\n")) {
    const [status, file] = line.split(/\t/);
    if (!file || isGoalArtifactPath(file)) continue;
    if (status?.startsWith("D") && TEST_PATH.test(file)) {
      issues.push(`deleted a test file: ${file}`);
    }
  }

  // Bypass patterns in added lines of tracked changes.
  for (const block of parseDiffAddedLines(git(root, "git diff HEAD"))) {
    if (isGoalArtifactPath(block.file)) continue;
    const text = block.added.join("\n");
    for (const [re, reason] of BYPASS) {
      if (re.test(text)) issues.push(`${reason} (${block.file})`);
    }
  }

  // New untracked files that ship pre-skipped/bypassed verification.
  for (const file of git(root, "git ls-files --others --exclude-standard")
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)) {
    if (isGoalArtifactPath(file) || !TEST_PATH.test(file)) continue;
    let body = "";
    try {
      body = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const [re, reason] of BYPASS) {
      if (re.test(body)) issues.push(`${reason} (${file})`);
    }
  }

  return [...new Set(issues)];
}

function normalizeScope(scope: string[]): string[] {
  return scope
    .map((s) => s.replace(/^\.\//, "").replace(/\/+$/, "").trim())
    .filter((s) => s && s !== "." && s !== "**");
}

/** Product files edited outside the declared scope (empty scope = no restriction). */
export function outOfScopeEdits(diffFiles: string[], scope: string[]): string[] {
  const norm = normalizeScope(scope);
  if (!norm.length) return [];
  return diffFiles.filter((f) => {
    if (isGoalArtifactPath(f) || f === "GOAL.md") return false;
    return !norm.some((s) => f === s || f.startsWith(`${s}/`));
  });
}

/** All integrity issues for a turn; non-empty blocks task completion. */
export function checkIntegrity(root: string, diffFiles: string[], scope: string[]): string[] {
  const tamper = detectTamper(root);
  const scopeViol = outOfScopeEdits(diffFiles, scope).map((f) => `edited out-of-scope file: ${f}`);
  return [...tamper, ...scopeViol];
}
