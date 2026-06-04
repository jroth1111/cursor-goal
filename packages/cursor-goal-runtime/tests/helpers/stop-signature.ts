import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "../../src/lib/paths.js";

/** Clear repeated-failure trail so stop-loop tests can run many continues (I230 still tests without this). */
export async function resetStopSignatureTrail(root: string, agentId: string): Promise<void> {
  const file = path.join(goalDir(root), "agents", agentId, "stop-signatures.jsonl");
  if (existsSync(file)) await rm(file);
}
