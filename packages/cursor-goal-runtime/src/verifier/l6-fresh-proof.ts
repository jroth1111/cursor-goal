import { gitTreeId, readState, writeState } from "../lib/git-state.js";
import type { LevelResult, VerifierContext } from "./types.js";

export async function levelFreshProofBlocked(ctx: VerifierContext): Promise<LevelResult> {
  const treeAtEnd = gitTreeId(ctx.root);
  if (treeAtEnd !== ctx.currentTree) {
    ctx.failures.push("stale-proof: working tree changed during verify");
  }

  const state = await readState(ctx.root);
  if (state.last_proof_tree && treeAtEnd !== state.last_proof_tree) {
    const checksOk =
      ctx.checkResults.length > 0 && ctx.checkResults.every((r) => r.ok);
    const fastProfileSkippedAllChecks =
      ctx.checkProfile === "fast" && ctx.checkResults.length === 0;
    if (!checksOk && !fastProfileSkippedAllChecks) {
      ctx.failures.push(
        `stale-proof: edits since last proof (${state.last_proof_tree})`,
      );
    }
  }

  return {};
}

/** After checks pass, sync proof tree (edits validated by this stop's check run). */
export async function levelFreshProofOnRelease(ctx: VerifierContext): Promise<void> {
  await writeState(ctx.root, {
    last_proof_tree: gitTreeId(ctx.root),
    last_edit_tree: gitTreeId(ctx.root),
  });
}
