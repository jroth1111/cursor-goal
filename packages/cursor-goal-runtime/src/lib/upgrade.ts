import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

export function runGlobalUpgrade(): { status: number; stdout: string; stderr: string } {
  const script = fileURLToPath(
    new URL("../../../../scripts/install-global.sh", import.meta.url),
  );
  if (!existsSync(script)) {
    return {
      status: 1,
      stdout: "",
      stderr: "install-global.sh not found — run from cursor-goal repo root\n",
    };
  }
  const r = spawnSync("bash", [script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}
