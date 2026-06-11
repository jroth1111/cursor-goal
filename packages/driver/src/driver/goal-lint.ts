import { existsSync } from "node:fs";
import path from "node:path";
import { maskHtmlComments, parseDriverSection } from "./intake.js";

/**
 * Static validation of GOAL.md. Authoring mistakes currently cost turns at run
 * time (a prose check fails every turn as `sh: command not found` and burns the
 * attempt ladder; a typoed scope path silently disables integrity protection) —
 * the linter makes them cost seconds instead.
 */
export type LintFinding = { severity: "error" | "warning"; line: number; message: string };

const KNOWN_SECTIONS = ["goal", "non-goals", "scope", "checks", "driver", "forbidden proxies"];

/** First tokens that mark a bullet as a runnable command. Judged on the FIRST
 *  token only: prose like "Make sure user-facing docs are updated." contains
 *  hyphens/periods everywhere, so any whole-string character heuristic lets
 *  ordinary sentences masquerade as commands. */
const COMMAND_WORDS =
  /^(npm|npx|yarn|pnpm|make|just|cargo|go|python3?|pytest|uv|node|bash|sh|test|true|false|git|curl|wget|grep|rg|echo|cd|ls|cat|diff|find|jq|docker|kubectl|tsc|vitest|jest)$/;

function looksLikeCommand(body: string): boolean {
  const first = body.trim().split(/\s+/)[0] ?? "";
  if (COMMAND_WORDS.test(first)) return true;
  if (first.includes("/") || first.includes("=") || first.startsWith("./") || first.startsWith("$")) return true;
  return / \| | && |\$\(/.test(body); // shell plumbing anywhere is command-like
}

function sectionRange(lines: string[], heading: string): { start: number; end: number } | null {
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function sectionBullets(lines: string[], range: { start: number; end: number }): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const t = lines[i].trim();
    if (t.startsWith("-") && t.length > 1) out.push({ line: i + 1, text: t.slice(1).trim() });
  }
  return out;
}

function hasProse(lines: string[], range: { start: number; end: number }): boolean {
  for (let i = range.start + 1; i < range.end; i++) {
    const t = lines[i].trim();
    if (t && !t.startsWith("-")) return true;
  }
  return false;
}

export function lintGoalMd(text: string, root?: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const masked = maskHtmlComments(text);
  const lines = masked.split("\n");

  // duplicate section headings: sectionBody takes the first; the second silently loses
  const seen = new Map<string, number>();
  lines.forEach((l, i) => {
    const m = l.trim().match(/^##\s+(.+?)\s*$/);
    if (!m) return;
    const name = m[1].toLowerCase();
    const first = seen.get(name);
    if (first != null) {
      findings.push({
        severity: "error",
        line: i + 1,
        message: `duplicate '## ${m[1]}' section — only the first (line ${first}) is read; this one is silently ignored`,
      });
    } else {
      seen.set(name, i + 1);
    }
    if (!KNOWN_SECTIONS.includes(name)) {
      findings.push({
        severity: "warning",
        line: i + 1,
        message: `unknown section '## ${m[1]}' (known: ${KNOWN_SECTIONS.map((s) => `## ${s}`).join(", ")})`,
      });
    }
  });

  // ## Goal: required, non-empty prose
  const goal = sectionRange(lines, "Goal");
  if (!goal) {
    findings.push({ severity: "error", line: 1, message: "missing '## Goal' section" });
  } else if (!hasProse(lines, goal)) {
    findings.push({ severity: "error", line: goal.start + 1, message: "'## Goal' has no description text" });
  }

  // ## Checks: backticked runnable commands; prose-as-shell is the classic runtime trap
  const checks = sectionRange(lines, "Checks");
  if (!checks) {
    findings.push({
      severity: "error",
      line: 1,
      message: "missing '## Checks' section — without it the planner must invent acceptance",
    });
  } else {
    const bullets = sectionBullets(lines, checks);
    if (!bullets.length) {
      findings.push({ severity: "error", line: checks.start + 1, message: "'## Checks' has no check bullets" });
    }
    for (const b of bullets) {
      const backticked = /^`[^`]+`$/.test(b.text);
      if (backticked) continue;
      const body = b.text.replace(/^`/, "").replace(/`$/, "");
      if (!looksLikeCommand(body) && body.split(/\s+/).length >= 4) {
        findings.push({
          severity: "error",
          line: b.line,
          message: `check looks like prose, not a shell command — it will fail every turn as 'command not found': '${body}'`,
        });
      } else {
        findings.push({
          severity: "warning",
          line: b.line,
          message: `check is not backticked: '${body}'`,
        });
      }
    }
  }

  // ## Scope: every non-glob entry should exist — a typo silently disables the fence
  const scope = sectionRange(lines, "Scope");
  if (scope && root) {
    for (const b of sectionBullets(lines, scope)) {
      const entry = b.text.replace(/^`/, "").replace(/`$/, "").trim();
      if (!entry || /[*?[\]]/.test(entry)) continue; // globs can't be cheaply verified
      if (!existsSync(path.join(root, entry))) {
        findings.push({
          severity: "error",
          line: b.line,
          message: `scope path '${entry}' does not exist — integrity protection for the real path is silently off`,
        });
      }
    }
  }

  // ## Driver: reuse the single parser; its warnings carry GOAL.md:N prefixes
  for (const w of parseDriverSection(text).warnings) {
    const m = w.match(/^GOAL\.md:(\d+): (.*)$/);
    findings.push({
      severity: "warning",
      line: m ? Number(m[1]) : 1,
      message: m ? m[2] : w,
    });
  }

  return findings.sort((a, b) => a.line - b.line);
}

export function formatFindings(findings: LintFinding[]): string {
  if (!findings.length) return "GOAL.md: clean\n";
  const lines = findings.map((f) => `GOAL.md:${f.line}: [${f.severity}] ${f.message}`);
  const errors = findings.filter((f) => f.severity === "error").length;
  lines.push(`${findings.length} finding(s), ${errors} error(s)`);
  return `${lines.join("\n")}\n`;
}
