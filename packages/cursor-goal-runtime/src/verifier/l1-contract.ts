import { existsSync } from "node:fs";
import { goalMd } from "../lib/paths.js";
import type { LevelResult, VerifierContext } from "./types.js";

export function levelContract(ctx: VerifierContext): LevelResult {
  if (!existsSync(goalMd(ctx.root))) {
    return {
      halt: true,
      kind: "continue",
      message:
        "GOAL.md is missing. Create it from .cursor/goal/templates/GOAL.md with ## Checks.",
    };
  }
  return {};
}
