import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseGoalMd } from "./parse-goal-md.js";
import { goalMd } from "./paths.js";

export type GoalAlignmentIssue = { level: "error" | "warn"; message: string };

const PLACEHOLDER_SNIPPETS = [
  "Describe the user-visible outcome in one paragraph",
  "Item the agent must not do",
];

function hasNpmChecks(checks: string[]): boolean {
  return checks.some((c) => /\bnpm\s+(test|run)\b/.test(c));
}

function hasUvOrPytestChecks(checks: string[]): boolean {
  return checks.some((c) => /\b(uv run|pytest)\b/.test(c));
}

function scopeExists(root: string, scopePath: string): boolean {
  const normalized = scopePath.replace(/\/$/, "");
  if (normalized === "**") return true;
  if (!normalized) return false;
  return existsSync(path.join(root, normalized));
}

/** Detect template GOAL / checks that do not match the repo layout. */
export async function auditGoalAlignment(root: string): Promise<GoalAlignmentIssue[]> {
  const issues: GoalAlignmentIssue[] = [];
  const file = goalMd(root);
  if (!existsSync(file)) return issues;

  let raw = "";
  let parsed: Awaited<ReturnType<typeof parseGoalMd>>;
  try {
    raw = await readFile(file, "utf8");
    parsed = await parseGoalMd(root);
  } catch {
    issues.push({ level: "error", message: "GOAL.md could not be parsed — fix markdown structure" });
    return issues;
  }

  for (const snippet of PLACEHOLDER_SNIPPETS) {
    if (raw.includes(snippet) || parsed.goalText.includes(snippet)) {
      issues.push({
        level: "warn",
        message:
          "GOAL.md still contains template placeholder text — replace ## Goal with your real objective before governed work",
      });
      break;
    }
  }

  const hasPackageJson = existsSync(path.join(root, "package.json"));
  const hasPyproject = existsSync(path.join(root, "pyproject.toml"));

  if (hasNpmChecks(parsed.checks) && !hasPackageJson) {
    issues.push({
      level: "error",
      message:
        "Checks use npm but this repo has no package.json — use project-native checks (e.g. uv run pytest) in GOAL.md",
    });
  }

  if (hasPyproject && hasNpmChecks(parsed.checks) && !hasUvOrPytestChecks(parsed.checks)) {
    issues.push({
      level: "warn",
      message:
        "Python project (pyproject.toml) but checks are npm-only — consider uv run pytest and scrape/evidence scripts",
    });
  }

  for (const unit of parsed.workUnits) {
    for (const s of unit.scope) {
      if (!scopeExists(root, s)) {
        issues.push({
          level: "warn",
          message: `Work unit "${unit.id}" scope "${s}" does not exist — fix GOAL.md or create the path`,
        });
      }
    }
    if (unit.id === "auth-middleware" && unit.scope.some((s) => s.includes("src/auth"))) {
      issues.push({
        level: "warn",
        message:
          'Work unit "auth-middleware" looks like default template — replace work units with your real delivery plan',
      });
    }
  }

  return issues;
}
