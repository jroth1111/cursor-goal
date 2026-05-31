import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function cursorHome(): string {
  return process.env.CURSOR_HOME ?? path.join(os.homedir(), ".cursor");
}

export function goalTemplatePath(): string {
  const globalTemplate = path.join(cursorHome(), "goal/templates/GOAL.md");
  if (existsSync(globalTemplate)) return globalTemplate;

  const monorepo = fileURLToPath(
    new URL("../../../../core/.cursor/goal/templates/GOAL.md", import.meta.url),
  );
  if (existsSync(monorepo)) return monorepo;

  return fileURLToPath(
    new URL("../../../../../core/.cursor/goal/templates/GOAL.md", import.meta.url),
  );
}
