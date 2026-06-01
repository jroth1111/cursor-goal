import path from "node:path";
import { goalDir, projectRoot, readJson } from "./paths.js";
import { readLoopLimitFromGlobalHooksJson, readLoopLimitFromHooksJson } from "./git-state.js";

const DEFAULT_LOOP_LIMIT = 40;

function validLoopLimit(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 1 ? Number(value) : null;
}

export async function readLoopLimit(root = projectRoot()): Promise<number> {
  const fromProjectHooks = readLoopLimitFromHooksJson(root);
  if (fromProjectHooks !== null) return fromProjectHooks;
  const manifest = await readJson<{ loop_limit?: unknown }>(
    path.join(goalDir(root), "manifest.json"),
  ).catch(() => null);
  const fromManifest = validLoopLimit(manifest?.loop_limit);
  if (fromManifest !== null) return fromManifest;
  const fromGlobalHooks = readLoopLimitFromGlobalHooksJson();
  if (fromGlobalHooks !== null) return fromGlobalHooks;
  return DEFAULT_LOOP_LIMIT;
}

export async function syncLoopLimitToManifest(root = projectRoot()): Promise<number> {
  const limit = await readLoopLimit(root);
  const { writeJson } = await import("./paths.js");
  const manifestPath = path.join(goalDir(root), "manifest.json");
  const existing = (await readJson<Record<string, unknown>>(manifestPath).catch(() => null)) ?? {};
  await writeJson(manifestPath, { ...existing, loop_limit: limit });
  return limit;
}
