#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const invariants = JSON.parse(readFileSync(path.join(root, "INVARIANTS.json"), "utf8"));
const invariantEntries = invariants.invariants ?? [];
const invariantById = new Map(invariantEntries.map((inv) => [inv.id, inv]));
const capability = readFileSync(path.join(root, "CAPABILITY.md"), "utf8");
const errors = [];

function normalizeTestStem(testPath) {
  return path.basename(testPath.trim(), ".test.ts");
}

function hasLayerClaim(value) {
  const normalized = value.trim();
  return normalized !== "" && normalized !== "—" && normalized !== "-";
}

const header = capability.split(/\r?\n/).find((line) => line.startsWith("| Invariant |"));
if (!header || !/\|\s*Core\s*\|\s*Runtime\s*\|\s*Supervisor\s*\|/.test(header)) {
  errors.push("CAPABILITY.md matrix must use Core, Runtime, and Supervisor layer columns");
}
if (header && /\|\s*Pi\s*\|/.test(header)) {
  errors.push("CAPABILITY.md matrix must not expose legacy Pi layer column");
}

for (const inv of invariantEntries) {
  const testPath = inv.test;
  if (!testPath) continue;
  const abs = path.join(root, testPath);
  if (!existsSync(abs)) {
    errors.push(`${inv.id}: missing test file ${testPath}`);
  }
}

const testedRows = [
  ...capability.matchAll(
    /^\|\s*(I\d+)\s*\|[^|]*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]+?)\s*\|\s*tested\s*\|/gm,
  ),
];
for (const [, id, core, runtime, supervisor, testRef] of testedRows) {
  const inv = invariantById.get(id);
  const stem = testRef.trim();
  if (!inv) {
    errors.push(`${id}: CAPABILITY tested row is not registered in INVARIANTS.json`);
    continue;
  }
  if (!inv.test) {
    errors.push(`${id}: CAPABILITY tested row exists but INVARIANTS.json declares no test`);
    continue;
  }
  const declaredStem = normalizeTestStem(inv.test);
  if (normalizeTestStem(stem) !== declaredStem) {
    errors.push(
      `${id}: CAPABILITY tested row references "${stem}" but INVARIANTS.json declares "${declaredStem}"`,
    );
  }
  if (hasLayerClaim(core) !== inv.layers?.includes("core")) {
    errors.push(`${id}: CAPABILITY Core column does not match INVARIANTS.json layers`);
  }
  if (hasLayerClaim(runtime) !== inv.layers?.includes("runtime")) {
    errors.push(`${id}: CAPABILITY Runtime column does not match INVARIANTS.json layers`);
  }
  if (hasLayerClaim(supervisor) !== inv.layers?.includes("supervisor")) {
    errors.push(`${id}: CAPABILITY Supervisor column does not match INVARIANTS.json layers`);
  }
  const candidates = [
    path.join(root, "packages/cursor-goal-runtime/tests/invariants", `${stem}.test.ts`),
    path.join(root, "packages/cursor-goal-runtime/tests/conformance", `${stem}.test.ts`),
    path.join(root, "packages/cursor-goal-runtime/tests", `${stem}.test.ts`),
    path.join(root, "packages/cursor-goal-runtime/tests/invariants", stem),
    path.join(root, "packages/cursor-goal-runtime/tests/conformance", stem),
  ];
  if (!candidates.some((p) => existsSync(p))) {
    errors.push(`${id}: CAPABILITY tested row references missing test "${stem}"`);
  }
}

for (const inv of invariantEntries) {
  if (!inv.test) continue;
  const inCap = capability.includes(`| ${inv.id} `);
  if (!inCap) {
    errors.push(`${inv.id}: registered in INVARIANTS.json but missing from CAPABILITY.md`);
  }
}

if (errors.length) {
  console.error("Capability/invariant verification failed:\n", errors.join("\n"));
  process.exit(1);
}

console.log(
  `INVARIANTS.json OK — ${invariants.invariants?.length ?? 0} entries; ${testedRows.length} tested CAPABILITY rows`,
);
