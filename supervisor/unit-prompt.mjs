import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function resolveRuntimePromptModule() {
  for (const base of [
    process.env.CURSOR_GOAL_RUNTIME,
    path.join(os.homedir(), ".cursor", "cursor-goal-runtime"),
    path.join(process.cwd(), "packages/cursor-goal-runtime"),
    path.join(process.cwd(), "node_modules/@cursor-goal/runtime"),
  ]) {
    if (!base) continue;
    const mod = path.join(base, "dist/lib/unit-task-prompt.js");
    if (existsSync(mod)) return pathToFileURL(mod).href;
  }
  return null;
}

const runtimeHref = resolveRuntimePromptModule();
const runtimeMod = runtimeHref ? await import(runtimeHref) : null;

/** Shared unit Task prompt — delegates to compiled runtime when available. */
export function buildUnitTaskPrompt(unit) {
  if (runtimeMod?.buildUnitTaskPrompt) {
    return runtimeMod.buildUnitTaskPrompt(unit);
  }
  const scope = unit.scope?.length ? unit.scope.join(", ") : "see GOAL.md";
  const acceptance =
    unit.acceptance?.length > 0
      ? unit.acceptance.map((c) => `- ${c}`).join("\n")
      : "- `true`";
  return [
    `work_unit_id: ${unit.id}`,
    "",
    `Complete work unit "${unit.title}" (${unit.id}).`,
    `Allowed scope: ${scope}`,
    `Do not write .cursor/goal except evidence/units/${unit.id}.jsonl`,
    "See .cursor/goal/templates/SUBAGENT_PROMPT.md",
    "",
    "Acceptance:",
    acceptance,
  ].join("\n");
}
