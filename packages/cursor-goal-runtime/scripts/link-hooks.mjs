import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooks = [
  "stop",
  "sessionStart",
  "beforeSubmitPrompt",
  "preToolUse",
  "beforeShellExecution",
  "postToolUse",
  "subagentStop",
  "sessionEnd",
];

await mkdir(path.join(root, "dist"), { recursive: true });

function fixImports(source) {
  return source
    .replace(/from "\.\.\/lib\//g, 'from "./lib/')
    .replace(/from "\.\.\/trajectory\//g, 'from "./trajectory/')
    .replace(/from "\.\.\/compile\//g, 'from "./compile/')
    .replace(/from "\.\.\/verifier\//g, 'from "./verifier/')
    .replace(/import\("\.\.\/lib\//g, 'import("./lib/')
    .replace(/import\("\.\.\/trajectory\//g, 'import("./trajectory/')
    .replace(/import\("\.\.\/compile\//g, 'import("./compile/')
    .replace(/import\("\.\.\/verifier\//g, 'import("./verifier/');
}

for (const name of hooks) {
  const src = path.join(root, "dist", "hooks", `${name}.js`);
  const dest = path.join(root, "dist", `hook-${name}.mjs`);
  const content = fixImports(await readFile(src, "utf8"));
  await writeFile(dest, content, "utf8");
}

await chmod(path.join(root, "dist", "cli.js"), 0o755);

console.log("Linked hook-*.mjs for cursor-goal dispatch");

try {
  const { spawnSync } = await import("node:child_process");
  const emit = path.join(root, "scripts/emit-unit-prompts.mjs");
  const r = spawnSync("node", [emit], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
} catch (e) {
  console.warn("emit-unit-prompts skipped:", e);
}
