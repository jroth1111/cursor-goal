export function defaultUnitAcceptance(
  unit: { id: string; scope: string[] },
  explicit: string[],
): string[] {
  if (explicit.length > 0) return explicit;
  if (unit.scope.length > 0) {
    return unit.scope.map((p) => {
      const normalized = p.replace(/\/$/, "");
      return `bash -c 'test -e ${normalized} || test -d ${normalized}'`;
    });
  }
  return [`test -s .cursor/goal/evidence/units/${unit.id}.jsonl`];
}
