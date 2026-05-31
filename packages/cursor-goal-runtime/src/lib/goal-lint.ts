import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditGoalAlignment, type GoalAlignmentIssue } from "./goal-alignment.js";
import { parseGoalMd } from "./parse-goal-md.js";
import { goalMd } from "./paths.js";

export type GoalLintIssue = GoalAlignmentIssue;

const PLACEHOLDER_SNIPPETS = [
  "Describe the user-visible outcome in one paragraph",
  "Item the agent must not do",
];

export async function lintGoalMd(root: string): Promise<GoalLintIssue[]> {
  const issues: GoalLintIssue[] = [];
  const file = goalMd(root);
  if (!existsSync(file)) {
    issues.push({ level: "error", message: "GOAL.md missing" });
    return issues;
  }

  let raw = "";
  try {
    raw = await readFile(file, "utf8");
    const parsed = await parseGoalMd(root);
    issues.push(...(await auditGoalAlignment(root)));

    if (!parsed.checks.length || parsed.checks.every((c) => c.trim() === "true")) {
      issues.push({
        level: "warn",
        message: "Checks are empty or only `true` — add project-native verification commands",
      });
    }
    for (const snippet of PLACEHOLDER_SNIPPETS) {
      if (raw.includes(snippet)) {
        issues.push({
          level: "warn",
          message: "GOAL.md still contains template placeholder text",
        });
        break;
      }
    }
    if (parsed.scope.length === 1 && [".", "./", "src/"].includes(parsed.scope[0])) {
      issues.push({
        level: "warn",
        message: "Scope is very broad — narrow paths for governed delivery",
      });
    }
    for (const unit of parsed.workUnits) {
      if (!unit.acceptance.length) {
        issues.push({
          level: "warn",
          message: `Work unit "${unit.id}" has no explicit acceptance criteria`,
        });
      }
    }
    void path.basename(file);
  } catch {
    issues.push({ level: "error", message: "GOAL.md could not be parsed" });
  }
  return issues;
}
