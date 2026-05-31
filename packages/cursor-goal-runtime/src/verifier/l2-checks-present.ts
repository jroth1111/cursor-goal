import type { LevelResult, VerifierContext } from "./types.js";

export function levelChecksPresent(ctx: VerifierContext): LevelResult {
  if (ctx.parsed.checks.length === 0) {
    return {
      halt: true,
      kind: "continue",
      message:
        "GOAL.md ## Checks is empty. Add at least one shell command (e.g. npm test) that must exit 0 before release.",
    };
  }
  return {};
}
