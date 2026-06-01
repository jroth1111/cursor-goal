#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const configPath = path.join(repoRoot, ".cursor/goal/orchestrator.json");

function exitWithError(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  process.exit(0);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  exitWithError("orchestrator.json is invalid JSON");
}

const auditDir = path.join(repoRoot, config.audit_dir ?? ".cursor-audit/orchestrator");
const markerName = config.marker ?? "ORCHESTRATOR_ACTIVE";
const markerPath = path.join(auditDir, markerName);
const masterStatusPath = path.join(auditDir, config.master_status ?? "MASTER_STATUS.md");
const orchestratorStatusJsonPath = path.join(auditDir, config.status_file ?? "ORCHESTRATOR_STATUS.json");
const finalReportPath = path.join(auditDir, config.final_report ?? "FINAL_REPORT.md");
const requiredDone = Array.isArray(config.required_done) ? config.required_done : [];

if (!fs.existsSync(markerPath)) {
  process.exit(0);
}

if (fs.existsSync(finalReportPath)) {
  process.exit(0);
}

if (!fs.existsSync(masterStatusPath)) {
  exitWithError(
    [
      "Orchestrator is marked active, but MASTER_STATUS.md is missing.",
      `Expected: ${path.relative(repoRoot, masterStatusPath)}`,
    ].join("\n"),
  );
}

function checkRequiredStatusesFromJson(json) {
  const required = Array.isArray(json?.requiredDone) ? json.requiredDone : requiredDone;
  const statuses = json?.phaseStatuses ?? json?.statuses ?? json?.doneStatuses ?? null;
  if (!required.length || !statuses || typeof statuses !== "object") {
    return null;
  }
  const missingOrNotDone = required
    .filter((label) => statuses[label] !== "DONE")
    .map((label) => `${label}=${statuses[label] ?? "MISSING"}`);
  if (missingOrNotDone.length > 0) {
    exitWithError(
      [
        "Orchestrator is marked active, but ORCHESTRATOR_STATUS.json is not complete yet.",
        "These required phases/parts must be `DONE`:",
        ...missingOrNotDone.map((x) => `- ${x}`),
      ].join("\n"),
    );
  }
  return true;
}

if (fs.existsSync(orchestratorStatusJsonPath)) {
  try {
    const json = JSON.parse(fs.readFileSync(orchestratorStatusJsonPath, "utf8"));
    if (checkRequiredStatusesFromJson(json)) process.exit(0);
  } catch {
    /* fall through */
  }
}

const content = fs.readFileSync(masterStatusPath, "utf8");
const lines = content.split(/\r?\n/);
const phaseSectionStart = lines.findIndex((l) => l.trim() === "## Phase progress");
if (phaseSectionStart < 0) {
  exitWithError("Could not find `## Phase progress` section in MASTER_STATUS.md.");
}

const phaseMap = new Map();
for (let i = phaseSectionStart + 1; i < lines.length; i += 1) {
  const line = lines[i].trim();
  if (!line) continue;
  if (!line.startsWith("|")) break;
  if (line.startsWith("| Phase") || line.startsWith("|-------")) continue;
  const parts = line.split("|").map((p) => p.trim());
  if (parts.length < 4) continue;
  const label = parts[1].replace(/\u2013/g, "-");
  const status = parts[2];
  if (label && status) phaseMap.set(label, status);
}

const missingOrNotDone = requiredDone
  .filter((label) => {
    const s = phaseMap.get(label);
    return !s || s !== "DONE";
  })
  .map((label) => {
    const s = phaseMap.get(label);
    return s ? `${label}=${s}` : `${label}=MISSING`;
  });

if (missingOrNotDone.length > 0) {
  exitWithError(
    [
      "Orchestrator is marked active, but MASTER_STATUS.md is not complete yet.",
      "These required phases/parts must be `DONE`:",
      ...missingOrNotDone.map((x) => `- ${x}`),
    ].join("\n"),
  );
}

process.exit(0);
