import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { goalMdPath } from "../lib/paths.js";
import type { DriverDefaults, GoalSpec } from "../state/schema.js";

/**
 * Blank out `<!-- … -->` spans while preserving line count, so commented-out
 * example bullets (the shipped template has them under Checks and Driver) are
 * never parsed as live configuration, and warning line numbers stay accurate.
 * An opener with NO closing `-->` is treated as literal text — masking to EOF
 * would silently erase every human-given check below a stray `<!--`.
 * Shared with the goal linter.
 */
export function maskHtmlComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("<!--", i);
    if (open < 0) {
      out += text.slice(i);
      break;
    }
    const close = text.indexOf("-->", open + 4);
    if (close < 0) {
      out += text.slice(i); // unterminated: keep everything literal
      break;
    }
    out += text.slice(i, open);
    out += "    " + text.slice(open + 4, close).replace(/[^\n]/g, " ") + "   ";
    i = close + 3;
  }
  return out;
}

function sectionBody(text: string, heading: string): string {
  text = maskHtmlComments(text);
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

const DRIVER_KEYS = {
  model: "string",
  brain_model: "string",
  max_turns: "number",
  review_rounds: "number",
  task_attempts: "number",
  notify_cmd: "string",
  evidence_cap_mb: "number",
} as const;

export type DriverSectionResult = { defaults: DriverDefaults; warnings: string[] };

/**
 * Parse the optional `## Driver` section: `- key: value` bullets with a small,
 * enumerated key set. Unknown keys and unparsable values warn with the GOAL.md
 * line number — a silently-ignored `max_turn` typo would be a budget that never
 * applied. Shared with the goal linter; keep this the single parser.
 */
export function parseDriverSection(text: string): DriverSectionResult {
  const defaults: DriverDefaults = {};
  const warnings: string[] = [];
  const lines = maskHtmlComments(text).split("\n");
  const start = lines.findIndex((l) => /^##\s+Driver\s*$/i.test(l.trim()));
  if (start < 0) return { defaults, warnings };
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const bullet = trimmed.slice(1).trim();
    const colon = bullet.indexOf(":");
    if (colon < 0) {
      warnings.push(`GOAL.md:${i + 1}: Driver bullet has no 'key: value' form: '${bullet}'`);
      continue;
    }
    const key = bullet.slice(0, colon).trim().replace(/^`/, "");
    // value may contain colons (e.g. a notify URL); split on the first only
    const value = bullet
      .slice(colon + 1)
      .trim()
      .replace(/^`/, "")
      .replace(/`$/, "")
      .trim();
    const kind = (DRIVER_KEYS as Record<string, string>)[key];
    if (!kind) {
      warnings.push(
        `GOAL.md:${i + 1}: unknown Driver key '${key}' (known: ${Object.keys(DRIVER_KEYS).join(", ")})`,
      );
      continue;
    }
    if (kind === "number") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        warnings.push(`GOAL.md:${i + 1}: Driver key '${key}' needs a non-negative number, got '${value}'`);
        continue;
      }
      (defaults as Record<string, number | string>)[key] = n;
    } else {
      if (!value) {
        warnings.push(`GOAL.md:${i + 1}: Driver key '${key}' has an empty value`);
        continue;
      }
      (defaults as Record<string, number | string>)[key] = value;
    }
  }
  return { defaults, warnings };
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
    const driver = parseDriverSection(text);
    for (const w of driver.warnings) process.stderr.write(`agent-driver: ${w}\n`);
    return {
      goal_text: goalText,
      source: "GOAL.md",
      acceptance_checks: bullets(text, "Checks"),
      non_goals: bullets(text, "Non-goals"),
      scope: bullets(text, "Scope"),
      driver_defaults: driver.defaults,
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
