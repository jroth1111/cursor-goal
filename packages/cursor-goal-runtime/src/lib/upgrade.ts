import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { cursorHome } from "./template.js";

function manifestInstallScript(): string | null {
  const manifestPath = path.join(cursorHome(), "cursor-goal/install-manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { source?: unknown };
    if (typeof manifest.source !== "string" || manifest.source.length === 0) return null;
    return path.join(manifest.source, "scripts/install-global.sh");
  } catch {
    return null;
  }
}

export function runGlobalUpgrade(): { status: number; stdout: string; stderr: string } {
  const fallbackScript = fileURLToPath(
    new URL("../../../../scripts/install-global.sh", import.meta.url),
  );
  const script = [manifestInstallScript(), fallbackScript].find(
    (candidate): candidate is string => Boolean(candidate && existsSync(candidate)),
  );
  if (!script) {
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
