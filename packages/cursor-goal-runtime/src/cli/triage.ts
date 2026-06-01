import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { goalDir, projectRoot } from "../lib/paths.js";
import { formatModeStatus, readLastTriageEntry, type TriageLogEntry } from "../lib/prompt-triage.js";
import { readGovernanceConfig, readSessionMode } from "../lib/governance-config.js";
import { isGovernanceActive } from "../lib/governance-active.js";
import { resolveAgentId } from "../lib/runtime-state.js";

const usage =
  "Usage: cursor-goal triage tail [N] [--conversation <id>] [--json] | cursor-goal triage why [--conversation <id>]";

function conversationFromArgs(rest: string[]): string | undefined {
  const i = rest.indexOf("--conversation");
  if (i >= 0 && rest[i + 1]) return rest[i + 1];
  const env = process.env.CURSOR_CONVERSATION_ID;
  return typeof env === "string" && env.trim() ? env.trim() : undefined;
}

function rejectUsage(): never {
  console.error(usage);
  process.exit(1);
}

async function readTriageTail(root: string, limit: number): Promise<TriageLogEntry[]> {
  const file = path.join(goalDir(root), "triage-log.jsonl");
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries: TriageLogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as TriageLogEntry);
    } catch {
      continue;
    }
  }
  return entries.slice(-limit);
}

export async function handleTriage(rest: string[]): Promise<void> {
  const root = projectRoot();
  const sub = rest[0];
  if (!sub) rejectUsage();

  if (sub === "why") {
    const conv = conversationFromArgs(rest.slice(1));
    const entry = await readLastTriageEntry(root, conv);
    if (!entry) {
      console.log("No triage log entry for this conversation");
      process.exit(1);
    }
    const session = await readSessionMode(root);
    const config = await readGovernanceConfig(root);
    const govActive = await isGovernanceActive(root, conv);
    const summary = {
      ...entry,
      session_mode: session?.mode ?? null,
      default_mode: config.default_mode,
      governance_active: govActive,
      mismatch: entry.classification.forceGoverned && entry.mode === "chat",
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (sub === "tail") {
    const args = rest.slice(1);
    const json = args.includes("--json");
    const conv = conversationFromArgs(args);
    let limit = 10;
    const numeric = args.find((a) => /^\d+$/.test(a));
    if (numeric) limit = Math.max(1, parseInt(numeric, 10));

    const entries = await readTriageTail(root, limit);
    const filtered = conv
      ? entries.filter((e) => e.agent_id === resolveAgentId({ conversation_id: conv }))
      : entries;

    const session = await readSessionMode(root);
    const config = await readGovernanceConfig(root);
    const last = filtered.length ? filtered[filtered.length - 1] : await readLastTriageEntry(root, conv);
    const govActive = await isGovernanceActive(root, conv);

    if (json) {
      console.log(
        JSON.stringify(
          {
            default_mode: config.default_mode,
            session_mode: session?.mode ?? null,
            governance_active: govActive,
            entries: filtered,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(formatModeStatus(config, session));
    console.log(`governance_active: ${govActive}`);
    if (last) {
      console.log(
        `last: mode=${last.mode} forceGoverned=${last.classification.forceGoverned} reasons=${last.reasons.join(",")}`,
      );
      if (last.classification.forceGoverned && last.mode === "chat") {
        console.log("MISMATCH: forceGoverned triage but mode=chat — run: cursor-goal mode governed");
      }
    } else {
      console.log("No triage entries");
    }
    for (const e of filtered) {
      console.log(
        `${e.at} agent=${e.agent_id} mode=${e.mode} force=${e.classification.forceGoverned}`,
      );
    }
    return;
  }

  rejectUsage();
}
