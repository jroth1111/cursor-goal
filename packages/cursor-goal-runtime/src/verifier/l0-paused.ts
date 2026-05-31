import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir } from "../lib/paths.js";
import type { LevelResult, VerifierContext } from "./types.js";

export function levelPaused(ctx: VerifierContext): LevelResult {
  if (existsSync(path.join(goalDir(ctx.root), "PAUSED"))) {
    return { halt: true, kind: "idle" };
  }
  if (ctx.input.status !== "completed") {
    return { halt: true, kind: "idle" };
  }
  return {};
}
