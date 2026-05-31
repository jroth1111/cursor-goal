import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { goalDir, goalMd, projectRoot } from "./paths.js";

export type InteractiveAnswers = {
  goal: string;
  checks: string[];
  scopes: string[];
};

export function buildGoalMarkdown(answers: InteractiveAnswers): string {
  const scopeLines = answers.scopes.length
    ? answers.scopes.map((s) => `- \`${s}\``).join("\n")
    : "- `src/`";
  const checkLines = (answers.checks.length ? answers.checks : ["true"])
    .map((c) => `- \`${c}\``)
    .join("\n");
  return [
    "# Goal",
    "",
    "## Goal",
    "",
    answers.goal,
    "",
    "## Non-goals",
    "",
    "- (edit as needed)",
    "",
    "## Scope",
    "",
    "Paths the agent may change (one per line):",
    "",
    scopeLines,
    "",
    "## Work units",
    "",
    "Optional. When omitted, one unit is created per Scope path.",
    "",
    "## Checks",
    "",
    "Machine-verified stopping condition. Each line is a shell command that must exit 0:",
    "",
    checkLines,
    "",
    "## Forbidden proxies",
    "",
    "Do not treat these as done without the checks above:",
    "",
    "- Tests pass but acceptance scenario untested",
    "- Plan written but not implemented",
    "- Agent narrative without fresh command output in PROGRESS.md",
    "",
  ].join("\n");
}

function answersFromLines(lines: string[]): InteractiveAnswers {
  let idx = 0;
  const goal = (lines[idx++] ?? "").trim();
  if (!goal) throw new Error("Goal paragraph is required");

  const checks: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const line = (lines[idx++] ?? "").trim();
    if (!line) {
      if (i === 1) checks.push("true");
      break;
    }
    checks.push(line);
  }

  const scopeRaw = (lines[idx++] ?? "").trim();
  const scopes = scopeRaw
    ? scopeRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : ["src/"];

  return { goal, checks, scopes };
}

async function answersFromPipedStdin(): Promise<InteractiveAnswers> {
  let raw = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    raw += chunk;
  }
  return answersFromLines(raw.split(/\r?\n/));
}

export async function promptInteractiveGoal(
  io?: { question: (q: string) => Promise<string> },
): Promise<InteractiveAnswers> {
  if (!io && !input.isTTY) {
    return answersFromPipedStdin();
  }

  const questioner = io ?? readline.createInterface({ input, output });
  try {
    const goal = (await questioner.question("Goal (one paragraph): ")).trim();
    if (!goal) throw new Error("Goal paragraph is required");

    const checks: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const line = (
        await questioner.question(
          i === 1 ? "Check command 1 (Enter for `true`): " : `Check command ${i} (Enter to finish): `,
        )
      ).trim();
      if (!line) {
        if (i === 1) checks.push("true");
        break;
      }
      checks.push(line);
    }

    const scopeRaw = (await questioner.question("Scope paths (comma-separated, Enter for `src/`): ")).trim();
    const scopes = scopeRaw
      ? scopeRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["src/"];

    return { goal, checks, scopes };
  } finally {
    if ("close" in questioner && typeof (questioner as readline.Interface).close === "function") {
      (questioner as readline.Interface).close();
    }
  }
}

export async function writeInteractiveGoal(
  root = projectRoot(),
  answers?: InteractiveAnswers,
): Promise<string> {
  const resolved = answers ?? (await promptInteractiveGoal());
  const dest = goalMd(root);
  await mkdir(goalDir(root), { recursive: true });
  await writeFile(dest, buildGoalMarkdown(resolved), "utf8");
  return dest;
}
