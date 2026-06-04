export type CursorHookEvent =
  | "beforeShellExecution"
  | "beforeSubmitPrompt"
  | "preToolUse"
  | "postToolUse"
  | "sessionStart"
  | "sessionEnd"
  | "stop"
  | "subagentStart"
  | "subagentStop"
  | "preCompact"
  | "afterAgentResponse"
  | "afterAgentThought"
  | "workspaceOpen";

const VALID_PERMISSIONS = new Set(["allow", "deny", "ask"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(out: Record<string, unknown>, key: string, value: unknown): void {
  if (typeof value === "string") out[key] = value;
}

function messageFields(out: Record<string, unknown>, raw: Record<string, unknown>): void {
  stringField(out, "user_message", raw.user_message);
  stringField(out, "agent_message", raw.agent_message);
}

function permissionFields(out: Record<string, unknown>, raw: Record<string, unknown>): void {
  if (typeof raw.permission === "string" && VALID_PERMISSIONS.has(raw.permission)) {
    out.permission = raw.permission;
  }
  messageFields(out, raw);
}

function envField(out: Record<string, unknown>, value: unknown): void {
  if (!isPlainObject(value)) return;
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") env[key] = entry;
  }
  if (Object.keys(env).length > 0) out.env = env;
}

function pluginPathsField(out: Record<string, unknown>, value: unknown): void {
  if (!Array.isArray(value)) return;
  const pluginPaths = value.filter((entry): entry is string =>
    typeof entry === "string" && entry.trim().length > 0,
  );
  if (pluginPaths.length > 0) out.pluginPaths = pluginPaths;
}

export function sanitizeHookResponse(
  event: CursorHookEvent | string | undefined,
  body: unknown,
): Record<string, unknown> {
  if (!isPlainObject(body)) return {};
  const out: Record<string, unknown> = {};

  switch (event) {
    case "beforeShellExecution":
    case "subagentStart":
      permissionFields(out, body);
      break;
    case "preToolUse":
      permissionFields(out, body);
      if (isPlainObject(body.updated_input)) out.updated_input = body.updated_input;
      break;
    case "beforeSubmitPrompt":
      if (typeof body.continue === "boolean") out.continue = body.continue;
      stringField(out, "user_message", body.user_message);
      break;
    case "sessionStart":
      envField(out, body.env);
      stringField(out, "additional_context", body.additional_context);
      if (typeof body.continue === "boolean") out.continue = body.continue;
      stringField(out, "user_message", body.user_message);
      stringField(out, "agent_message", body.agent_message);
      break;
    case "stop":
      stringField(out, "followup_message", body.followup_message);
      break;
    case "subagentStop":
      stringField(out, "followup_message", body.followup_message);
      messageFields(out, body);
      break;
    case "preCompact":
      stringField(out, "user_message", body.user_message);
      break;
    case "postToolUse":
      stringField(out, "additional_context", body.additional_context);
      if (
        typeof body.updated_mcp_tool_output === "string" ||
        isPlainObject(body.updated_mcp_tool_output)
      ) {
        out.updated_mcp_tool_output = body.updated_mcp_tool_output;
      }
      messageFields(out, body);
      break;
    case "workspaceOpen":
      pluginPathsField(out, body.pluginPaths);
      messageFields(out, body);
      break;
    case "sessionEnd":
    case "afterAgentResponse":
    case "afterAgentThought":
      messageFields(out, body);
      break;
    default:
      messageFields(out, body);
      stringField(out, "followup_message", body.followup_message);
      stringField(out, "additional_context", body.additional_context);
      if (typeof body.continue === "boolean") out.continue = body.continue;
      if (typeof body.permission === "string" && VALID_PERMISSIONS.has(body.permission)) {
        out.permission = body.permission;
      }
      if (isPlainObject(body.updated_input)) out.updated_input = body.updated_input;
      envField(out, body.env);
      pluginPathsField(out, body.pluginPaths);
      break;
  }

  return out;
}

export function inferHookEvent(argv = process.argv): CursorHookEvent | undefined {
  const script = argv[1] ?? "";
  const match = /hook-([A-Za-z]+)\.mjs$/.exec(script);
  if (!match) return undefined;
  const event = match[1];
  return [
    "beforeShellExecution",
    "beforeSubmitPrompt",
    "preToolUse",
    "postToolUse",
    "sessionStart",
    "sessionEnd",
    "stop",
    "subagentStart",
    "subagentStop",
    "preCompact",
    "afterAgentResponse",
    "afterAgentThought",
    "workspaceOpen",
  ].includes(event)
    ? (event as CursorHookEvent)
    : undefined;
}
