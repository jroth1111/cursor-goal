import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { goalMd } from "./paths.js";

export type DetectedChecks = {
  commands: string[];
  source: string;
};

function readPackageScripts(root: string): Record<string, string> | null {
  const file = path.join(root, "package.json");
  if (!existsSync(file)) return null;
  try {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return null;
  }
}

export function detectProjectChecks(root: string): DetectedChecks {
  const scripts = readPackageScripts(root);
  if (scripts) {
    const commands: string[] = [];
    if (scripts.test) commands.push("npm test");
    if (scripts.lint) commands.push("npm run lint");
    if (commands.length) return { commands, source: "package.json" };
  }
  if (existsSync(path.join(root, "pyproject.toml"))) {
    return { commands: ["uv run pytest"], source: "pyproject.toml" };
  }
  if (existsSync(path.join(root, "Cargo.toml"))) {
    return { commands: ["cargo test"], source: "Cargo.toml" };
  }
  return { commands: ["true"], source: "fallback" };
}

function replaceMarkdownSection(raw: string, heading: string, block: string): string {
  const headingMatch = new RegExp(`^## ${heading}\\b.*$`, "m").exec(raw);
  if (!headingMatch) {
    return `${raw.trim()}\n\n${block}`.trim() + "\n";
  }

  const start = headingMatch.index;
  const afterHeading = start + headingMatch[0].length;
  const rest = raw.slice(afterHeading);
  const nextHeading = /^##\s/m.exec(rest);
  const end = nextHeading ? afterHeading + nextHeading.index : raw.length;
  const before = raw.slice(0, start).trimEnd();
  const after = raw.slice(end).trimStart();
  return [before, block.trimEnd(), after].filter(Boolean).join("\n\n") + "\n";
}

export async function applyDetectedChecks(root: string): Promise<DetectedChecks> {
  const detected = detectProjectChecks(root);
  const file = goalMd(root);
  let raw = "";
  if (existsSync(file)) {
    raw = await readFile(file, "utf8");
  }
  const block = [
    "## Checks",
    "",
    "Machine-verified stopping condition. Each line is a shell command that must exit 0:",
    "",
    ...detected.commands.map((c) => `- \`${c}\``),
    "",
  ].join("\n");
  raw = replaceMarkdownSection(raw, "Checks", block);
  await writeFile(file, raw, "utf8");
  return detected;
}
