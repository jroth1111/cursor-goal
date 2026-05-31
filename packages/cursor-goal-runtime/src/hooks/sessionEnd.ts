import { existsSync } from "node:fs";
import path from "node:path";
import { resolveAgentId } from "../lib/runtime-state.js";
import { passportsDir, projectRoot, writeJson } from "../lib/paths.js";
import { sessionEndMarkerPath } from "../lib/disposition.js";
import { hookJson } from "../lib/verify.js";
import { readStdinJson } from "../lib/stdin.js";

const root = projectRoot();
const input = await readStdinJson<{ conversation_id?: string }>();
const agentId = resolveAgentId(input);
const release = path.join(passportsDir(root), "RELEASE.json");

if (!existsSync(release)) {
  await writeJson(sessionEndMarkerPath(root), {
    status: "SESSION_END",
    reason: "session_end_without_release",
    agent_id: agentId,
    conversation_id: input.conversation_id,
    at: new Date().toISOString(),
  });
}

hookJson({});
