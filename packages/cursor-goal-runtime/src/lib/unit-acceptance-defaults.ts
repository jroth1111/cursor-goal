export function defaultUnitAcceptance(
  unit: { id: string; scope: string[] },
  explicit: string[],
): string[] {
  if (explicit.length > 0) return explicit;
  return [`test -s .cursor/goal/evidence/units/${unit.id}.jsonl`];
}
