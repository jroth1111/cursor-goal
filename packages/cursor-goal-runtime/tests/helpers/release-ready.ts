import { writeFile } from "node:fs/promises";
import path from "node:path";

/** Minimal artifacts so runtime stop can RELEASE (I21 phase gate). */
export async function seedReleaseReady(dir: string): Promise<void> {
  await writeFile(
    path.join(dir, ".cursor/goal/trajectory.json"),
    JSON.stringify({ phase: "VERIFY" }),
    "utf8",
  );
  await writeFile(
    path.join(dir, ".cursor/goal/discovery.json"),
    JSON.stringify({ completed: true, notes: "ok" }),
    "utf8",
  );
}
