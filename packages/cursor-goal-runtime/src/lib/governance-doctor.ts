import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { goalDir, goalMd, readJson } from "./paths.js";
import { cursorHome } from "./template.js";
import { parseGoalMd } from "./parse-goal-md.js";
import { readSessionMode } from "./governance-config.js";
import { readLastTriageEntry } from "./prompt-triage.js";
import type { DoctorIssue } from "./doctor.js";

type HooksStopEntry = { command?: string; timeout?: number; loop_limit?: number };
type HooksMap = { hooks?: HooksMap; stop?: HooksStopEntry[] };

function flattenHooks(raw: { hooks?: HooksMap }): HooksMap | null {
  let hooks = raw.hooks;
  for (let i = 0; i < 8 && hooks?.hooks; i += 1) {
    hooks = hooks.hooks;
  }
  return hooks ?? null;
}

function readStopTimeoutSeconds(filePath: string): number | null {
  if (!existsSync(filePath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(filePath, "utf8")) as { hooks?: HooksMap };
    const stop = flattenHooks(cfg)?.stop;
    if (!stop?.length) return null;
    for (const h of stop) {
      if (typeof h.timeout === "number" && h.timeout >= 1) return h.timeout;
    }
    return null;
  } catch {
    return null;
  }
}

function readStopTimeoutForRoot(root: string): number | null {
  const project = readStopTimeoutSeconds(path.join(root, ".cursor", "hooks.json"));
  if (project !== null) return project;
  return readStopTimeoutSeconds(path.join(cursorHome(), "hooks.json"));
}

function checksIncludeHeavyTest(commands: string[]): boolean {
  return commands.some((c) => /\bnpm\s+(run\s+)?test\b/.test(c) || /\bvitest\b/.test(c));
}

export async function auditGovernanceMismatch(root: string): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const session = await readSessionMode(root);

  const triage = await readLastTriageEntry(root);
  if (session?.mode === "chat" && triage?.classification?.forceGoverned) {
    issues.push({
      level: "warn",
      message:
        "session-mode=chat but last triage was forceGoverned (/goal) — stop checks may be skipped. Run: cursor-goal mode governed",
    });
  }

  const orchPath = path.join(goalDir(root), "orchestrator.json");
  if (existsSync(orchPath)) {
    try {
      const orch = (await readJson<{
        audit_dir?: string;
        marker?: string;
      }>(orchPath)) ?? {};
      const auditDir = orch.audit_dir ?? ".cursor-audit/orchestrator";
      const markerName = orch.marker ?? "ORCHESTRATOR_ACTIVE";
      const markerPath = path.join(root, auditDir, markerName);
      if (existsSync(markerPath) && session?.mode === "chat") {
        issues.push({
          level: "warn",
          message:
            "Orchestrator run active but session-mode=chat — run: cursor-goal orchestrator start (or cursor-goal mode governed)",
        });
      }
    } catch {
      issues.push({ level: "warn", message: "orchestrator.json unreadable" });
    }
  }

  const checksPath = path.join(goalDir(root), "checks.json");
  const intentPath = path.join(goalDir(root), "intent.json");
  if (existsSync(goalMd(root)) && existsSync(checksPath) && existsSync(intentPath)) {
    try {
      const checksData = await readJson<{ commands?: string[] }>(checksPath);
      const intentData = await readJson<{ checks?: string[] }>(intentPath);
      if (!checksData || !intentData) {
        issues.push({ level: "warn", message: "Could not read checks.json or intent.json" });
      } else {
      const fromChecks = [...(checksData.commands ?? [])].sort().join("\n");
      const fromIntent = [...(intentData.checks ?? [])].sort().join("\n");
      if (fromChecks !== fromIntent) {
        issues.push({
          level: "warn",
          message: "intent.json checks differ from checks.json — run: cursor-goal compile",
        });
      }
      const parsed = await parseGoalMd(root);
      const fromGoal = [...parsed.checks].sort().join("\n");
      if (fromGoal !== fromChecks) {
        issues.push({
          level: "warn",
          message: "GOAL.md Checks section differs from compiled checks.json — run: cursor-goal compile",
        });
      }
      }
    } catch {
      issues.push({ level: "warn", message: "Could not compare GOAL.md / checks.json / intent.json" });
    }
  }

  const commands =
    existsSync(checksPath)
      ? ((await readJson<{ commands?: string[] }>(checksPath).catch(() => null))?.commands ?? [])
      : existsSync(goalMd(root))
        ? (await parseGoalMd(root)).checks
        : [];

  if (checksIncludeHeavyTest(commands)) {
    const timeout = readStopTimeoutForRoot(root);
    const recommended = 600;
    if (timeout !== null && timeout < recommended) {
      issues.push({
        level: "warn",
        message: `hooks.json stop.timeout=${timeout}s may be too low for npm test in GOAL checks (recommend ≥${recommended}s)`,
      });
    }
  }

  return issues;
}
