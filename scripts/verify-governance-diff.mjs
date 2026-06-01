#!/usr/bin/env node
/**
 * Warn (or fail in strict mode) when governance files change without acknowledgment.
 * Set CURSOR_GOAL_GOVERNANCE_OK=1 after a green npm test when editing CAPABILITY.md / INVARIANTS.json.
 */
import { execSync } from "node:child_process";

const strict = /^(1|true|yes)$/i.test(process.env.CURSOR_GOAL_STRICT ?? "");
const acknowledged = /^(1|true|yes)$/i.test(process.env.CURSOR_GOAL_GOVERNANCE_OK ?? "");

function changedFiles() {
  const out = execSync("git diff --name-only HEAD && git diff --name-only --cached", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return [...new Set(out.split("\n").filter(Boolean))];
}

const governance = changedFiles().filter(
  (f) => f === "CAPABILITY.md" || f === "INVARIANTS.json" || f.endsWith("/INVARIANTS.json"),
);

if (governance.length === 0) {
  process.exit(0);
}

if (acknowledged) {
  process.exit(0);
}

const msg =
  `Governance files changed (${governance.join(", ")}) without CURSOR_GOAL_GOVERNANCE_OK=1. ` +
  "Run npm test, then export CURSOR_GOAL_GOVERNANCE_OK=1 before committing tested rows.";

if (strict) {
  console.error(msg);
  process.exit(1);
}

console.warn(`warning: ${msg}`);
