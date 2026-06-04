import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { goalDir, goalMd, readJson } from "./paths.js";

async function compileGoalIfAvailable(root?: string): Promise<void> {
  // Keep compile dependencies out of hook load path until compilation is needed.
  const { compileGoalV2 } = await import("../compile/compile-v2.js");
  await compileGoalV2(root);
}

export async function isGoalStale(root?: string): Promise<boolean> {
  const md = goalMd(root);
  if (!existsSync(md)) return false;
  const manifestPath = path.join(goalDir(root), "manifest.json");
  if (!existsSync(manifestPath)) return true;
  let manifest: { compiled_at?: string; goal_fingerprint?: string } | null;
  try {
    manifest = await readJson<{ compiled_at?: string; goal_fingerprint?: string }>(manifestPath);
  } catch {
    return true;
  }
  if (manifest?.goal_fingerprint) {
    const current = createHash("sha256").update(await readFile(md)).digest("hex");
    if (current !== manifest.goal_fingerprint) return true;
  }
  if (!manifest?.compiled_at) return true;
  const goalStat = await stat(md);
  const compiledAt = Date.parse(manifest.compiled_at);
  if (Number.isNaN(compiledAt)) return true;
  return goalStat.mtimeMs > compiledAt;
}

export async function requireFreshCompile(root?: string): Promise<void> {
  const md = goalMd(root);
  if (!existsSync(md)) {
    throw new Error("GOAL.md missing. Run: cursor-goal init");
  }
  const stale = await isGoalStale(root);
  if (stale || !existsSync(path.join(goalDir(root), "work-units.json"))) {
    await compileGoalIfAvailable(root);
    return;
  }
  const stillStale = await isGoalStale(root);
  if (stillStale) {
    throw new Error("GOAL.md changed after compile. Run: cursor-goal compile");
  }
}
