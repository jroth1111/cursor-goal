import { readStdinJson } from "../lib/stdin.js";
import { checkShellGate } from "../lib/shell-allow.js";
import { projectRoot } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";

const input = await readStdinJson<{ command?: string }>();
const cmd = input.command ?? "";
const gate = await checkShellGate(cmd, projectRoot());

if (!gate.allowed) {
  hookJson({ permission: "deny", agent_message: gate.reason });
  process.exit(0);
}

hookJson({ permission: "allow" });
