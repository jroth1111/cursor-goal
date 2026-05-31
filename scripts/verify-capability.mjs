#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const invariants = JSON.parse(readFileSync(path.join(root, "INVARIANTS.json"), "utf8"));
const capability = readFileSync(path.join(root, "CAPABILITY.md"), "utf8");
const errors = [];
const warnings = [];

for (const inv of invariants.invariants ?? []) {
  const testPath = inv.test;
  if (!testPath) continue;
  const abs = path.join(root, testPath);
  if (!existsSync(abs)) {
    errors.push(`${inv.id}: missing test file ${testPath}`);
  }
}

const testedRows = [...capability.matchAll(/\|\s*(I\d+)\s*\|[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*[^|]*\|\s*([^|]+?)\s*\|\s*tested\s*\|/g)];
for (const [, id, testStem] of testedRows) {
  const stem = testStem.trim();
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

for (const inv of invariants.invariants ?? []) {
  if (!inv.test) continue;
  const stem = path.basename(inv.test, ".test.ts");
  const inCap = capability.includes(`| ${inv.id} `);
  if (!inCap) {
    warnings.push(`${inv.id}: registered in INVARIANTS.json but missing from CAPABILITY.md`);
  }
}

if (warnings.length) {
  console.warn("Capability warnings:\n", warnings.join("\n"));
}

if (errors.length) {
  console.error("Capability/invariant verification failed:\n", errors.join("\n"));
  process.exit(1);
}

console.log(
  `INVARIANTS.json OK — ${invariants.invariants?.length ?? 0} entries; ${testedRows.length} tested CAPABILITY rows`,
);
