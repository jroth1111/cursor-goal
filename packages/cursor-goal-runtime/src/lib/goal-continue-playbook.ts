export function goalMissingPlaybook(): string {
  return [
    "Governed run requested but GOAL.md is missing. Suggested sequence:",
    "1. cursor-goal init --interactive (or copy .cursor/goal/templates/GOAL.md)",
    "2. cursor-goal compile",
    '3. cursor-goal discovery complete "inventory what already exists"',
    "4. cursor-goal next",
  ].join(" ");
}

export function discoveryIncompleteNudge(): string {
  return 'Discovery not complete — run: cursor-goal discovery complete "notes" before dispatching work units';
}
