import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "./paths.js";

export function pausedMarkerPath(root: string): string {
  return path.join(goalDir(root), "PAUSED");
}

export async function setPaused(root: string): Promise<void> {
  await mkdir(goalDir(root), { recursive: true });
  await writeFile(pausedMarkerPath(root), "", "utf8");
}

export async function clearPaused(root: string): Promise<void> {
  await unlink(pausedMarkerPath(root)).catch(() => undefined);
}

export async function isPaused(root: string): Promise<boolean> {
  const { existsSync } = await import("node:fs");
  return existsSync(pausedMarkerPath(root));
}
