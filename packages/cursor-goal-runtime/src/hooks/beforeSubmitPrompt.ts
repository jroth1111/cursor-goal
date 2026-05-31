import { existsSync } from "node:fs";
import path from "node:path";
import { requireFreshCompile } from "../lib/compile-stale.js";
import { resolveAgentId } from "../lib/runtime-state.js";
import { hasAgentDisposition, isAgentSubmitBlocked } from "../lib/disposition.js";
import { goalDir, goalMd, projectRoot } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import { nudgeMessage, resolveEffectiveMode, appendTriageLog } from "../lib/prompt-triage.js";
import { isStrictGovernance } from "../lib/strict-mode.js";
import { resolveRuntimeRoot } from "../lib/resolve-runtime.js";

async function main(): Promise<void> {
  const root = projectRoot();
  const input = await readStdinJson<{ prompt?: string; attachments?: unknown[]; conversation_id?: string }>();
  const prompt = input.prompt ?? "";
  const agentId = resolveAgentId(input);
  const notes: string[] = [];

  if (existsSync(path.join(goalDir(root), "PAUSED"))) {
    notes.push("Goal paused (.cursor/goal/PAUSED); stop verification is idle until cursor-goal resume");
  }

  let resolved: Awaited<ReturnType<typeof resolveEffectiveMode>>;
  try {
    resolved = await resolveEffectiveMode(root, prompt, input.conversation_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(`Governance triage unavailable (${msg}); continuing fail-open`);
    hookJson({ continue: true, agent_message: notes.join("; ") });
    return;
  }

  await appendTriageLog(root, prompt, resolved.mode, input.conversation_id).catch(() => undefined);

  if (resolved.mode === "chat") {
    hookJson(notes.length ? { continue: true, agent_message: notes.join("; ") } : { continue: true });
    return;
  }

  if (isStrictGovernance() && !resolveRuntimeRoot(root)) {
    hookJson({
      continue: false,
      agent_message:
        "CURSOR_GOAL_STRICT=1: runtime missing — run npm run install:global or npm run build before governed delivery",
    });
    return;
  }

  if (resolved.mode === "nudge") {
    notes.push(nudgeMessage(resolved.nudgeKind ?? "delivery"));
    hookJson({
      continue: true,
      agent_message: notes.join("; "),
    });
    return;
  }

  if (!existsSync(goalMd(root))) {
    notes.push("Create GOAL.md before a governed run: cursor-goal init");
    hookJson({ continue: true, agent_message: notes.join("; ") });
    return;
  }

  try {
    await requireFreshCompile(root);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const compileUnavailable = /Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(msg);
    notes.push(
      compileUnavailable
        ? `${msg}. Compile runtime unavailable; normal work may continue, but release requires a working runtime/checks.`
        : `${msg}. Fix GOAL.md and run: cursor-goal compile`,
    );
  }

  try {
    if (await isAgentSubmitBlocked(root, agentId)) {
      const inDisposition = await hasAgentDisposition(root, agentId);
      notes.push(
        inDisposition
          ? `Disposition exists for this conversation — see .cursor/goal/agents/${agentId}/DISPOSITION.md`
          : `Governed run has blocker state for this conversation — see .cursor/goal/agents/${agentId}/runtime-state.json or run: cursor-goal next --conversation ${agentId}`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(`Runtime state unreadable (${msg}); continuing fail-open`);
  }

  hookJson(notes.length ? { continue: true, agent_message: notes.join("; ") } : { continue: true });
}

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  hookJson({ continue: true, agent_message: `beforeSubmitPrompt warning: ${msg}; continuing fail-open` });
}
