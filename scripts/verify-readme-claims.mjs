#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const capabilityPath = path.join(root, "CAPABILITY.md");

if (!existsSync(capabilityPath)) {
  console.error("CAPABILITY.md missing");
  process.exit(1);
}

const capability = readFileSync(capabilityPath, "utf8");
const errors = [];

if (/Full verifier \(L0–L8\)/i.test(readme) && /pending/i.test(capability)) {
  errors.push('README claims "Full verifier (L0–L8)" but CAPABILITY.md still has pending rows');
}

if (/full verifier/i.test(readme) && !/tested/i.test(capability)) {
  errors.push("README mentions full verifier without tested capabilities in CAPABILITY.md");
}

if (errors.length) {
  console.error("README claim verification failed:\n", errors.join("\n"));
  process.exit(1);
}

console.log("README claims OK relative to CAPABILITY.md");
