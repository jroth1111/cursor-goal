#!/usr/bin/env node
/** Local smoke: run E2E stop-loop integration (same gate as CI via npm test). */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = path.join(root, "packages/cursor-goal-runtime");

const r = spawnSync(
  "npm",
  ["test", "--", "--run", "tests/integration/e2e-stop-loop.test.ts"],
  { cwd: pkg, encoding: "utf8", stdio: "inherit" },
);
process.exit(r.status ?? 1);
