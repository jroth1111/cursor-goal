/** Shared unit Task prompt for supervisor (mirrors runtime stop-playbook). */
export function buildUnitTaskPrompt(unit) {
  const scope = unit.scope?.length ? unit.scope.join(", ") : "see GOAL.md";
  const acceptance =
    unit.acceptance?.length > 0
      ? unit.acceptance.map((c) => `- ${c}`).join("\n")
      : "- run GOAL.md ## Checks";
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
