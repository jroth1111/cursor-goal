#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "cursor-goal-parity-"));

try {
  const cursorHome = path.join(temp, "cursor");
  const home = path.join(temp, "home");
  const bin = path.join(temp, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const install = spawnSync("bash", [path.join(root, "scripts/install-global.sh"), "--skip-build"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CURSOR_HOME: cursorHome,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    },
  });
  if (install.status !== 0) {
    process.stderr.write(install.stderr || install.stdout);
    process.exit(install.status ?? 1);
  }

  const reportPath = path.join(cursorHome, "cursor-goal/install-verify.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const checks = report.checks ?? {};
  if (!report.ok || !checks.runtime_cli_smoke?.ok || !checks.runtime_hook_smoke?.ok) {
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(1);
  }
  console.log("Installed runtime smoke OK");
  console.log("Installed parity OK");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
