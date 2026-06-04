import path from "node:path";
import { goalDir, readJson } from "./paths.js";
import { buildPromptContext } from "./prompt-context.js";

export async function promptScopeWarning(
  root: string,
  prompt: string,
  conversationId?: string,
): Promise<string | null> {
  const scope = await readJson<{ paths?: string[]; enforce?: boolean }>(
    path.join(goalDir(root), "scope.json"),
  ).catch(() => null);
  const paths = scope?.paths ?? [];
  const context = await buildPromptContext(root, prompt, {
    mode: "governed",
    effectiveMode: "governed",
    interactionModeHint: "delivery",
    conversationId,
  });

  const issues: string[] = [];
  if (context.out_of_scope_paths.length) {
    issues.push(
      `outside active GOAL scope: ${context.out_of_scope_paths.join(", ")} (active scope: [${paths.join(", ")}])`,
    );
  }
  if (context.unknown_units.length) {
    issues.push(`unknown unit(s): ${context.unknown_units.join(", ")}`);
  }
  if (context.unit_role_mismatches.length) {
    issues.push(
      `unit role mismatch: ${context.unit_role_mismatches
        .map((m) => `${m.unit_id} is role=${m.expected_role}, prompt requested ${m.requested_role}`)
        .join("; ")}`,
    );
  }

  if (!issues.length) return null;
  const next =
    conversationId && conversationId !== "default"
      ? `cursor-goal next --conversation ${conversationId}`
      : "cursor-goal next";
  return [
    `Prompt intent conflicts with active GOAL: ${issues.join("; ")}.`,
    `Correction: ${next}`,
    "Fallback: keep work inside active scope and target a valid open unit.",
  ].join(" ");
}
