import { readStdinJson } from "../lib/stdin.js";
import { checkShellGate } from "../lib/shell-allow.js";
import { projectRoot } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";

async function main(): Promise<void> {
const input = await readStdinJson<{ command?: string }>();
const cmd = input.command ?? "";
const gate = await checkShellGate(cmd, projectRoot());

if (!gate.allowed) {
  hookJson({ permission: "deny", agent_message: gate.reason });
  process.exit(0);
}

hookJson({ permission: "allow" });
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({
    permission: "allow",
    agent_message: `beforeShellExecution warning: ${msg}; continuing fail-open`,
  });
}
