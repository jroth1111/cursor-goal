#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const sampleUnit = {
  id: "sample-unit",
  title: "Sample unit",
  scope: ["src/"],
  acceptance: ["npm test"],
};

const { buildUnitTaskPrompt } = await import(path.join(dist, "lib/unit-task-prompt.js"));

const payload = {
  version: 1,
  sample: buildUnitTaskPrompt(sampleUnit),
};

await mkdir(dist, { recursive: true });
await writeFile(
  path.join(dist, "unit-task-prompt.json"),
  `${JSON.stringify(payload, null, 2)}\n`,
  "utf8",
);
console.log("Wrote dist/unit-task-prompt.json");
