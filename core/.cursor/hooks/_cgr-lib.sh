# cursor-goal core — runtime resolution (optional package / supervisor safe)
# shellcheck shell=bash
set -euo pipefail

_cgr_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$_cgr_lib_dir/destructive-shell-policy.sh" ]]; then
  # shellcheck source=/dev/null
  source "$_cgr_lib_dir/destructive-shell-policy.sh"
fi

_cgr_hook_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

cgr_realpath() {
  local p="$1"
  if [[ -d "$p" ]]; then
    (cd "$p" && pwd -P)
  else
    printf '%s\n' "$p"
  fi
}

cgr_cursor_hooks_root() {
  local cursor_home="${CURSOR_HOME:-${HOME}/.cursor}"
  cgr_realpath "$cursor_home/hooks"
}

cgr_root_is_hook_install_dir() {
  local root hooks
  root="$(cgr_realpath "$1")"
  hooks="$(cgr_cursor_hooks_root)"
  [[ "$root" == "$hooks" || "$root" == "$hooks/"* ]]
}

_cgr_project_root() {
  if [[ -n "${CURSOR_PROJECT_DIR:-}" ]]; then
    cgr_realpath "$CURSOR_PROJECT_DIR"
    return
  fi
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  cgr_realpath "$root"
}

_cgr_project_root_checked() {
  local root
  root="$(_cgr_project_root)"
  if [[ -z "${CURSOR_PROJECT_DIR:-}" ]] && cgr_root_is_hook_install_dir "$root"; then
    return 2
  fi
  printf '%s\n' "$root"
}

# Prints absolute path to cursor-goal-runtime package root, or empty.
cgr_resolve_runtime() {
  local root
  root="$(_cgr_project_root)"

  if [[ -n "${CURSOR_GOAL_RUNTIME:-}" ]]; then
    if [[ -f "$CURSOR_GOAL_RUNTIME/dist/hook-stop.mjs" ]]; then
      printf '%s\n' "$CURSOR_GOAL_RUNTIME"
      return
    fi
  fi

  local cursor_home="${CURSOR_HOME:-${HOME}/.cursor}"
  local candidates=(
    "$cursor_home/cursor-goal-runtime"
    "$root/packages/cursor-goal-runtime"
    "$root/node_modules/@cursor-goal/runtime"
  )
  local p
  for p in "${candidates[@]}"; do
    if [[ -f "$p/dist/hook-stop.mjs" ]]; then
      printf '%s\n' "$p"
      return
    fi
  done
  printf '\n'
}

cgr_strict_enabled() {
  case "${CURSOR_GOAL_STRICT:-}" in
    1|true|yes|TRUE|YES) return 0 ;;
    *) return 1 ;;
  esac
}

cgr_apply_strict_before_submit() {
  local step="$1"
  local out="$2"
  if [[ "$step" != "beforeSubmitPrompt" ]] || ! cgr_strict_enabled; then
    printf '%s\n' "$out"
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    local patched
    patched="$(printf '%s' "$out" | jq '.continue = false | .agent_message = ((.agent_message // "") + "; CURSOR_GOAL_STRICT=1: runtime missing — run npm run build")' 2>/dev/null || true)"
    if [[ -n "$patched" ]]; then
      printf '%s\n' "$patched"
      return 0
    fi
  fi
  printf '{"continue":false,"agent_message":"CURSOR_GOAL_STRICT=1: cursor-goal runtime not built. Run: npm run build"}\n'
}

cgr_no_runtime_message() {
  printf '%s' "cursor-goal runtime not built. Using fail-open/minimal safety fallback. Run: npm run build"
}

cgr_no_runtime_response() {
  local step="$1"
  local msg
  msg="$(cgr_no_runtime_message)"
  # Fail open without depending on jq: the no-runtime safety path must never
  # become a hard error just because jq is unavailable. The message is a fixed
  # string with no JSON-special chars, so direct interpolation is safe.
  case "$step" in
    preToolUse|beforeShellExecution)
      printf '{"permission":"allow","agent_message":"%s"}\n' "$msg"
      ;;
    beforeSubmitPrompt)
      if cgr_strict_enabled; then
        printf '{"continue":false,"agent_message":"CURSOR_GOAL_STRICT=1: %s"}\n' "$msg"
      else
        printf '{"continue":true,"agent_message":"%s"}\n' "$msg"
      fi
      ;;
    sessionStart)
      printf '{"continue":true,"agent_message":"%s"}\n' "$msg"
      ;;
    stop)
      printf '{}\n'
      ;;
    *)
      printf '{"agent_message":"%s"}\n' "$msg"
      ;;
  esac
}

cgr_e2e_trace() {
  local step="$1"
  local runtime="$2"
  local hint="${3:-}"
  if [[ "${CURSOR_GOAL_E2E_TRACE:-}" != "1" ]]; then
    return 0
  fi
  local root="${CURSOR_PROJECT_DIR:-}"
  if [[ -z "$root" ]]; then
    root="$(_cgr_project_root)"
  fi
  local trace_file="$root/.cursor/goal/e2e-trace.jsonl"
  mkdir -p "$(dirname "$trace_file")"
  local hint_trunc="${hint:0:500}"
  if ! command -v jq >/dev/null 2>&1; then
    return 0
  fi
  jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg step "$step" \
    --arg runtime "$runtime" \
    --arg hint "$hint_trunc" \
    '{ts:$ts,step:$step,runtime:$runtime,exit_hint:$hint}' \
    >>"$trace_file"
}

cgr_attach_agent_message() {
  local out="$1"
  local msg="$2"
  if [[ -z "$msg" ]]; then
    printf '%s\n' "$out"
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    local patched
    patched="$(printf '%s' "$out" | jq --arg m "$msg" '.agent_message = (if (.agent_message? // "") == "" then $m else ((.agent_message | tostring) + "; " + $m) end)' 2>/dev/null || true)"
    if [[ -n "$patched" ]]; then
      printf '%s\n' "$patched"
      return 0
    fi
  fi
  printf '%s\n' "$out"
}

cgr_json_string_field() {
  local input="$1"
  local field="$2"
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$input" | node -e '
const fs = require("node:fs");
const field = process.argv[1];
try {
  const raw = fs.readFileSync(0, "utf8");
  const data = raw ? JSON.parse(raw) : {};
  const value = data?.[field] ?? data?.tool_input?.[field] ?? "";
  process.stdout.write(typeof value === "string" ? value : "");
} catch {}
' "$field" 2>/dev/null || true
    return 0
  fi
  printf '%s' "$input" | sed -nE "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\\1/p" | head -1
}

cgr_json_bool_field() {
  local input="$1"
  local field="$2"
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$input" | node -e '
const fs = require("node:fs");
const field = process.argv[1];
try {
  const raw = fs.readFileSync(0, "utf8");
  const data = raw ? JSON.parse(raw) : {};
  const value = data?.[field] ?? data?.tool_input?.[field] ?? false;
  process.stdout.write(value === true || value === "true" ? "true" : "false");
} catch {
  process.stdout.write("false");
}
' "$field" 2>/dev/null || true
    return 0
  fi
  if printf '%s' "$input" | grep -qE "\"$field\"[[:space:]]*:[[:space:]]*true"; then
    printf 'true'
  else
    printf 'false'
  fi
}

cgr_normalize_path() {
  local raw="$1"
  if command -v node >/dev/null 2>&1; then
    node -e '
const fs = require("node:fs");
const path = require("node:path");
const raw = process.argv[1] || "";
const slash = raw.replace(/\\/g, "/");
if (!path.isAbsolute(slash)) {
  process.stdout.write(path.posix.normalize(slash));
  process.exit(0);
}
const resolved = path.resolve(slash);
let cursor = resolved;
const suffix = [];
while (!fs.existsSync(cursor)) {
  const parent = path.dirname(cursor);
  if (parent === cursor) {
    process.stdout.write(resolved.replace(/\\/g, "/"));
    process.exit(0);
  }
  suffix.unshift(path.basename(cursor));
  cursor = parent;
}
try {
  process.stdout.write(path.join(fs.realpathSync(cursor), ...suffix).replace(/\\/g, "/"));
} catch {
  process.stdout.write(resolved.replace(/\\/g, "/"));
}
' "$raw" 2>/dev/null || printf '%s' "${raw//\\//}"
    return 0
  fi
  printf '%s' "${raw//\\//}"
}

cgr_path_inside_project() {
  local file="$1"
  local root norm root_norm
  root="$(_cgr_project_root)"
  norm="$(cgr_normalize_path "$file")"
  root_norm="$(cgr_normalize_path "$root")"
  if [[ "$norm" == /* ]]; then
    [[ "$norm" == "$root_norm" || "$norm" == "$root_norm/"* ]]
    return
  fi
  [[ "$norm" != ".." && "$norm" != ../* ]]
}

if ! declare -f cgr_destructive_shell >/dev/null 2>&1; then
  cgr_destructive_shell() {
    return 1
  }
fi

destructive_shell() {
  cgr_destructive_shell "$@"
}

cgr_jq_loop_limit_from_file() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  jq -r '
    def flatten_hooks:
      if (.hooks.hooks? | type) == "object" then .hooks | flatten_hooks else . end;
    flatten_hooks | .hooks.stop[]? | select(.loop_limit != null) | .loop_limit
  ' "$f" 2>/dev/null | head -1
}

cgr_read_loop_limit() {
  local root="$1"
  local cursor_home="${CURSOR_HOME:-${HOME}/.cursor}"
  local hl ml=""
  hl="$(cgr_jq_loop_limit_from_file "$root/.cursor/hooks.json")"
  if [[ -n "$hl" && "$hl" != "null" ]]; then
    printf '%s\n' "$hl"
    return 0
  fi
  if [[ -f "$root/.cursor/goal/manifest.json" ]]; then
    ml="$(jq -r '.loop_limit // empty' "$root/.cursor/goal/manifest.json" 2>/dev/null | head -1)"
    if [[ -n "$ml" && "$ml" != "null" ]]; then
      printf '%s\n' "$ml"
      return 0
    fi
  fi
  hl="$(cgr_jq_loop_limit_from_file "$cursor_home/hooks.json")"
  if [[ -n "$hl" && "$hl" != "null" ]]; then
    printf '%s\n' "$hl"
    return 0
  fi
  printf '40\n'
}

cgr_runtime_missing_note_allowed() {
  local root="${CURSOR_PROJECT_DIR:-}"
  [[ -n "$root" ]] || return 0
  local flag="$root/.cursor/goal/.warned-runtime-missing"
  if [[ -f "$flag" ]]; then
    return 1
  fi
  mkdir -p "$(dirname "$flag")"
  touch "$flag"
  return 0
}

cgr_subagent_governance_safety() {
  local input="$1"
  local is_sub file wuid norm
  is_sub="$(cgr_json_bool_field "$input" "is_subagent")"
  [[ "$is_sub" == "true" ]] || return 1

  file="$(cgr_json_string_field "$input" "file_path")"
  if [[ -z "$file" ]]; then
    file="$(cgr_json_string_field "$input" "path")"
  fi
  [[ -n "$file" ]] || return 1

  norm="$(cgr_normalize_path "$file")"
  if [[ "$norm" != ".cursor/goal" && "$norm" != .cursor/goal/* && "$norm" != */.cursor/goal && "$norm" != */.cursor/goal/* ]]; then
    return 1
  fi

  wuid="$(cgr_json_string_field "$input" "work_unit_id")"
  if [[ "$wuid" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ && "$norm" =~ (^|/)\.cursor/goal/evidence/units/${wuid}\.jsonl$ ]]; then
    if ! cgr_path_inside_project "$file"; then
      printf '{"permission":"deny","agent_message":"Subagent WriteGate: path outside project root"}\n'
      return 0
    fi
    return 1
  fi

  printf '{"permission":"deny","agent_message":"Subagents may not write .cursor/goal governance files without runtime safety checks."}\n'
  return 0
}

cgr_safety_response() {
  local step="$1"
  local input="$2"
  local tool cmd
  tool="$(cgr_json_string_field "$input" "tool_name")"
  cmd="$(cgr_json_string_field "$input" "command")"
  if [[ "$step" == "beforeShellExecution" || "$tool" == "Shell" || "$tool" == "Bash" ]]; then
    if cgr_destructive_shell "$cmd"; then
      printf '{"permission":"deny","agent_message":"Destructive shell blocked by cursor-goal minimal policy."}\n'
      return 0
    fi
  fi
  if [[ "$step" == "preToolUse" ]]; then
    if cgr_subagent_governance_safety "$input"; then
      return 0
    fi
  fi
  return 1
}

cgr_root_resolution_response() {
  local step="$1"
  local input="$2"
  local msg="CURSOR_PROJECT_DIR missing; refusing to use global hooks directory as project root."
  local tool cmd file is_sub norm
  tool="$(cgr_json_string_field "$input" "tool_name")"
  cmd="$(cgr_json_string_field "$input" "command")"
  if [[ "$step" == "beforeShellExecution" || "$tool" == "Shell" || "$tool" == "Bash" ]]; then
    if cgr_destructive_shell "$cmd"; then
      printf '{"permission":"deny","agent_message":"Destructive shell blocked by cursor-goal minimal policy; %s"}\n' "$msg"
      return 0
    fi
  fi
  if [[ "$step" == "preToolUse" ]]; then
    is_sub="$(cgr_json_bool_field "$input" "is_subagent")"
    file="$(cgr_json_string_field "$input" "file_path")"
    if [[ -z "$file" ]]; then
      file="$(cgr_json_string_field "$input" "path")"
    fi
    norm="$(cgr_normalize_path "$file")"
    if [[ "$is_sub" == "true" && ( "$norm" == ".cursor/goal" || "$norm" == .cursor/goal/* || "$norm" == */.cursor/goal || "$norm" == */.cursor/goal/* ) ]]; then
      printf '{"permission":"deny","agent_message":"Subagent governance write denied; %s"}\n' "$msg"
      return 0
    fi
  fi
  case "$step" in
    stop)
      printf '{"followup_message":"cursor-goal: %s"}\n' "$msg"
      ;;
    beforeSubmitPrompt)
      if cgr_strict_enabled; then
        printf '{"continue":false,"agent_message":"CURSOR_GOAL_STRICT=1: cursor-goal: %s"}\n' "$msg"
      else
        printf '{"continue":true,"agent_message":"cursor-goal: %s"}\n' "$msg"
      fi
      ;;
    preToolUse|beforeShellExecution)
      printf '{"permission":"allow","agent_message":"cursor-goal: %s"}\n' "$msg"
      ;;
    sessionStart)
      printf '{"continue":true,"agent_message":"cursor-goal: %s"}\n' "$msg"
      ;;
    *)
      printf '{"agent_message":"cursor-goal: %s"}\n' "$msg"
      ;;
  esac
}

cgr_minimal_response() {
  local step="$1"
  local input="$2"
  local note="${3:-}"
  local lib out rc err_file err
  lib="$(_cgr_hook_dir)"
  err_file="$(mktemp "${TMPDIR:-/tmp}/cgr-minimal.XXXXXX")"

  set +e
  case "$step" in
    stop) out="$(printf '%s' "$input" | bash "$lib/verify-minimal.sh" stop 2>"$err_file")" ;;
    sessionStart) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" sessionStart 2>"$err_file")" ;;
    beforeSubmitPrompt) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" beforeSubmitPrompt 2>"$err_file")" ;;
    preToolUse) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" preToolUse 2>"$err_file")" ;;
    beforeShellExecution) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" beforeShellExecution 2>"$err_file")" ;;
    postToolUse) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" postToolUse 2>"$err_file")" ;;
    subagentStop) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" subagentStop 2>"$err_file")" ;;
    sessionEnd) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" sessionEnd 2>"$err_file")" ;;
    preCompact) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" preCompact 2>"$err_file")" ;;
    *) out='{}' ;;
  esac
  rc=$?
  err="$(cat "$err_file" 2>/dev/null)"
  rm -f "$err_file"
  set -e

  if [[ "$rc" -ne 0 || -z "$out" ]]; then
    local safety
    safety="$(cgr_safety_response "$step" "$input" || true)"
    if [[ -n "$safety" ]]; then
      cgr_attach_agent_message "$safety" "$note"
      return 0
    fi
    if [[ -n "$err" && -z "$note" ]]; then
      note="minimal fallback failed for $step: ${err:0:300}"
    fi
    out="$(cgr_no_runtime_response "$step")"
  fi
  out="$(cgr_attach_agent_message "$out" "$note")"
  cgr_apply_strict_before_submit "$step" "$out"
}

cgr_dispatch() {
  local step="$1"
  local rt out rc input note err_file err root
  local trace_on=0
  [[ "${CURSOR_GOAL_E2E_TRACE:-}" == "1" ]] && trace_on=1
  input="$(cat)"

  if ! root="$(_cgr_project_root_checked)"; then
    cgr_root_resolution_response "$step" "$input"
    exit 0
  fi
  export CURSOR_PROJECT_DIR="$root"

  rt="$(cgr_resolve_runtime)"
  if [[ -n "$rt" ]]; then
    err_file="$(mktemp "${TMPDIR:-/tmp}/cgr-node.XXXXXX")"
    set +e
    out="$(printf '%s' "$input" | node "$rt/dist/hook-$step.mjs" 2>"$err_file")"
    rc=$?
    err="$(cat "$err_file" 2>/dev/null)"
    rm -f "$err_file"
    set -e
    if [[ "$rc" -eq 0 ]]; then
      if [[ "$trace_on" -eq 1 ]]; then
        cgr_e2e_trace "$step" "node" "$out"
      fi
      printf '%s\n' "$out"
      exit 0
    fi

    note="cursor-goal runtime hook failed for $step; using fail-open/minimal safety fallback: ${err:-$out}"
    out="$(cgr_minimal_response "$step" "$input" "${note:0:500}")"
    if [[ "$trace_on" -eq 1 ]]; then
      cgr_e2e_trace "$step" "minimal-after-node-failure" "$out"
    fi
    printf '%s\n' "$out"
    exit 0
  fi

  note="$(cgr_no_runtime_message)"
  if ! cgr_runtime_missing_note_allowed; then
    note=""
  fi
  out="$(cgr_minimal_response "$step" "$input" "$note")"
  if [[ "$trace_on" -eq 1 ]]; then
    cgr_e2e_trace "$step" "minimal-no-runtime" "$out"
  fi
  printf '%s\n' "$out"
  exit 0
}
