export function isStrictGovernance(): boolean {
  const v = process.env.CURSOR_GOAL_STRICT;
  return v === "1" || v === "true" || v === "yes";
}
