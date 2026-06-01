import type { WorkUnitCompiled } from "../compile/compile-v2.js";

export function buildUnitTaskPrompt(unit: WorkUnitCompiled): string {
  const scope = unit.scope.length ? unit.scope.join(", ") : "see GOAL.md";
  const acceptance =
    unit.acceptance.length > 0
      ? unit.acceptance.map((c) => `- ${c}`).join("\n")
      : "- `true`";
  const deliverableLines = unit.verified_by
    ? [
        "",
        `Write deliverable to .cursor/goal/outputs/${unit.id}/deliverable.md (see SUBAGENT_PROMPT.md)`,
      ]
    : [];

  return [
    `work_unit_id: ${unit.id}`,
    "",
    `Complete work unit "${unit.title}" (${unit.id}).`,
    `Allowed scope: ${scope}`,
    "Do not write .cursor/goal except evidence/units/" + unit.id + ".jsonl",
    "See .cursor/goal/templates/SUBAGENT_PROMPT.md",
    ...deliverableLines,
    "",
    "Acceptance:",
    acceptance,
    "",
    "Completion:",
    "- Return one final summary with evidence paths when done",
    "- Do not spawn nested review subagents or repeat handoff blocks",
    "- Stop after this unit's acceptance criteria are met",
  ].join("\n");
}
