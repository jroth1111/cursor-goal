import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "../lib/paths.js";
import type { VerifierContext } from "./types.js";

const PROXY_PHRASES = [
  /tests?\s+pass(ed)?\s+but/i,
  /plan\s+written\s+but\s+not\s+implemented/i,
  /should\s+work/i,
  /looks?\s+good\s+to\s+me/i,
  /done\s+without\s+running/i,
];

export function scanProxyLanguage(text: string, forbidden: string[]): string[] {
  const hits: string[] = [];
  for (const phrase of forbidden) {
    if (phrase && text.toLowerCase().includes(phrase.toLowerCase().slice(0, 40))) {
      hits.push(phrase);
    }
  }
  for (const re of PROXY_PHRASES) {
    if (re.test(text)) hits.push(re.source);
  }
  return hits;
}

export async function levelInvalidators(ctx: VerifierContext): Promise<{ halt: boolean; kind?: "continue"; message?: string }> {
  const progress = path.join(goalDir(ctx.root), "PROGRESS.md");
  if (!existsSync(progress)) return { halt: false };
  const text = await readFile(progress, "utf8");
  const hits = scanProxyLanguage(text, ctx.parsed.forbiddenProxies);
  if (hits.length > 0) {
    ctx.failures.push(`forbidden-proxy-language: ${hits.slice(0, 3).join("; ")}`);
    return {
      halt: true,
      kind: "continue",
      message: `PROGRESS.md contains forbidden proxy language. Re-run checks and update evidence. Hits: ${hits.slice(0, 2).join(", ")}`,
    };
  }
  return { halt: false };
}

export async function levelDeliverableCoherence(
  ctx: VerifierContext,
): Promise<{ halt: boolean; message?: string }> {
  const snapPath = path.join(goalDir(ctx.root), "target-snapshot.json");
  if (!existsSync(snapPath)) return { halt: false };
  const intent = ctx.parsed.goalText ?? "";
  const hash = Buffer.from(intent).toString("base64url").slice(0, 16);
  try {
    const snap = JSON.parse(await readFile(snapPath, "utf8")) as { goal_summary_hash?: string };
    if (snap.goal_summary_hash && snap.goal_summary_hash !== hash) {
      ctx.failures.push("deliverable-incoherent: goal text changed since discovery snapshot");
      return {
        halt: true,
        message:
          "Goal text changed since discovery snapshot. Re-run: cursor-goal discovery complete",
      };
    }
  } catch {
    return { halt: false };
  }
  return { halt: false };
}

export function levelIntentStructure(ctx: VerifierContext): void {
  if (!ctx.parsed.goalText || ctx.parsed.goalText.length < 1) {
    ctx.failures.push("intent: goal text too short");
    ctx.followupMessage =
      "GOAL ## Goal section is empty. Add a goal statement before continuing.";
  }
}
