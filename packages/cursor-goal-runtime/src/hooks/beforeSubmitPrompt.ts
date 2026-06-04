import { existsSync } from "node:fs";
import path from "node:path";
import { requireFreshCompile } from "../lib/compile-stale.js";
import { resolveAgentId } from "../lib/runtime-state.js";
import { hasAgentDisposition, isAgentSubmitBlocked, sessionEndMarkerPath } from "../lib/disposition.js";
import { goalDir, goalMd, projectRoot } from "../lib/paths.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";
import {
  classifyPrompt,
  resolveEffectiveMode,
  appendTriageLog,
  hasGovernedContract,
  parseGoalSlashAction,
  shouldPersistGovernedSession,
} from "../lib/prompt-triage.js";
import { isStrictGovernance } from "../lib/strict-mode.js";
import { resolveRuntimeRoot } from "../lib/resolve-runtime.js";
import {
  isGovernedPromptBlock,
  readGovernanceConfig,
  writeSessionMode,
} from "../lib/governance-config.js";
import { formatGovernedSubmitHeader } from "../lib/governed-submit-header.js";
import { promptScopeWarning } from "../lib/prompt-scope-warning.js";
import { writePromptContext } from "../lib/prompt-context.js";
import { unlink } from "node:fs/promises";
import { clearPaused, setPaused } from "../lib/goal-pause.js";
import { goalMissingPlaybook } from "../lib/goal-continue-playbook.js";

async function main(): Promise<void> {
  const root = projectRoot();
  const input = await readStdinJson<{ prompt?: string; attachments?: unknown[]; conversation_id?: string }>();
  const prompt = input.prompt ?? "";
  const agentId = resolveAgentId(input);
  const notes: string[] = [];
  const slashAction = parseGoalSlashAction(prompt);

  if (slashAction === "pause") {
    await setPaused(root);
    hookJson({
      continue: false,
      user_message: "cursor-goal paused. Resume with /goal resume or cursor-goal resume.",
    });
    return;
  }

  if (slashAction === "resume") {
    await clearPaused(root);
    hookJson({ continue: false, user_message: "cursor-goal resumed." });
    return;
  }

  if (slashAction === "continue" && !existsSync(goalMd(root))) {
    hookJson({ continue: false, user_message: goalMissingPlaybook() });
    return;
  }

  if (existsSync(path.join(goalDir(root), "PAUSED"))) {
    notes.push("Goal paused (.cursor/goal/PAUSED); stop verification is idle until cursor-goal resume");
  }

  if (existsSync(sessionEndMarkerPath(root))) {
    notes.push(
      "SESSION_END present — resume: cursor-goal explain session-end && cursor-goal session-end clear --force && cursor-goal next",
    );
  }

  // One-shot alignment warning — consume after reading.
  const alignmentMarker = path.join(goalDir(root), ".alignment-warning");
  if (existsSync(alignmentMarker)) {
    notes.push(
      "Scope drift detected: last 3 edits were outside compiled scope. Verify work aligns with GOAL.md scope before continuing.",
    );
    await unlink(alignmentMarker).catch(() => undefined);
  }

  const classified = classifyPrompt(prompt);
  let resolved: Awaited<ReturnType<typeof resolveEffectiveMode>>;
  try {
    resolved = await resolveEffectiveMode(root, prompt, input.conversation_id);
  } catch (e) {
    hookJson({ continue: true });
    return;
  }

  if (classified.forceGoverned && resolved.mode === "chat") {
    notes.push(
      "Session pinned to chat; stop-loop disabled. Run: cursor-goal mode governed",
    );
  }

  try {
    const config = await readGovernanceConfig(root);
    const hasContract = await hasGovernedContract(root);
    if (
      shouldPersistGovernedSession(classified, resolved.mode, config, hasContract)
    ) {
      await writeSessionMode(root, "governed", "triage", resolved.interactionModeHint);
      if (resolved.mode !== "governed") {
        resolved = {
          mode: "governed",
          triageReasons: ["session_escalated"],
          interactionModeHint: resolved.interactionModeHint ?? "delivery",
        };
      }
    }
  } catch {
    /* session write is best-effort */
  }

  await appendTriageLog(
    root,
    prompt,
    resolved.mode,
    input.conversation_id,
    resolved.triageReasons,
    resolved.interactionModeHint,
  ).catch(() => undefined);

  let promptContextWritten = false;
  const persistPromptContext = async (): Promise<void> => {
    if (promptContextWritten) return;
    promptContextWritten = true;
    await writePromptContext(root, prompt, {
      mode: resolved.mode,
      effectiveMode: resolved.mode,
      interactionModeHint: resolved.interactionModeHint,
      conversationId: input.conversation_id,
    }).catch(() => undefined);
  };

  if (resolved.mode === "chat") {
    await persistPromptContext();
    hookJson({ continue: true });
    return;
  }

  if (isStrictGovernance() && !resolveRuntimeRoot(root)) {
    await persistPromptContext();
    hookJson({
      continue: false,
      user_message:
        "CURSOR_GOAL_STRICT=1: runtime missing — run npm run install:global or npm run build before governed delivery",
    });
    return;
  }

  if (resolved.mode === "nudge") {
    await persistPromptContext();
    hookJson({
      continue: true,
    });
    return;
  }

  const promptBlock = await isGovernedPromptBlock(root);

  if (!existsSync(goalMd(root))) {
    const msg = "Create GOAL.md before a governed run: cursor-goal init";
    await persistPromptContext();
    if (promptBlock) {
      hookJson({ continue: false, user_message: notes.length ? `${notes.join("; ")}; ${msg}` : msg });
      return;
    }
    notes.push(msg);
    hookJson({ continue: true });
    return;
  }

  try {
    await requireFreshCompile(root);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const compileUnavailable = /Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(msg);
    const compileNote = compileUnavailable
      ? `${msg}. Compile runtime unavailable; normal work may continue, but release requires a working runtime/checks.`
      : `${msg}. Fix GOAL.md and run: cursor-goal compile`;
    await persistPromptContext();
    if (promptBlock && !compileUnavailable) {
      hookJson({
        continue: false,
        user_message: notes.length ? `${notes.join("; ")}; ${compileNote}` : compileNote,
      });
      return;
    }
    notes.push(compileNote);
  }

  await persistPromptContext();

  if (resolved.mode === "governed") {
    const header = await formatGovernedSubmitHeader(root).catch(() => null);
    if (header) notes.unshift(header);
    const scopeWarning = await promptScopeWarning(root, prompt, input.conversation_id).catch(() => null);
    if (scopeWarning) {
      hookJson({
        continue: false,
        user_message: notes.length ? `${notes.join("; ")}; ${scopeWarning}` : scopeWarning,
      });
      return;
    }
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

  hookJson({ continue: true });
}

try {
  await main();
} catch (e) {
  hookJson({ continue: true });
}
