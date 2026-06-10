import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { goalMdPath } from "../lib/paths.js";
import type { GoalSpec } from "../state/schema.js";

function sectionBody(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l.trim()));
  if (start < 0) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

function bullets(text: string, heading: string): string[] {
  return sectionBody(text, heading)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.slice(1).trim().replace(/^`/, "").replace(/`$/, "").trim())
    .filter(Boolean);
}

function paragraph(text: string, heading: string): string {
  return sectionBody(text, heading)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("-"))
    .join(" ")
    .trim();
}

/**
 * Turn a user goal into a GoalSpec. A GOAL.md (with ## Goal / ## Checks / ## Scope)
 * is the structured path; a freeform prompt is wrapped with empty acceptance, in
 * which case the planner is responsible for proposing per-task acceptance.
 */
export async function intake(goalInput: string, root: string): Promise<GoalSpec> {
  const goalMd = goalMdPath(root);
  if (existsSync(goalMd)) {
    const text = await readFile(goalMd, "utf8");
    const goalText = paragraph(text, "Goal") || goalInput || "Complete work per GOAL.md";
    return {
      goal_text: goalText,
      source: "GOAL.md",
      acceptance_checks: bullets(text, "Checks"),
      non_goals: bullets(text, "Non-goals"),
      scope: bullets(text, "Scope"),
    };
  }
  return {
    goal_text: goalInput.trim() || "Complete the requested work",
    source: "prompt",
    acceptance_checks: [],
    non_goals: [],
    scope: [],
  };
}
