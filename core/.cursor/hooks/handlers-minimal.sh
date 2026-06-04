#!/usr/bin/env bash
# Minimal non-stop hooks — passthrough unless obvious block
set -euo pipefail

_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$_lib/_cgr-lib.sh"

STEP="${1:-}"
INPUT="$(cat)"

realpath_dir() {
  local p="$1"
  if [[ -d "$p" ]]; then
    (cd "$p" && pwd -P)
  else
    printf '%s\n' "$p"
  fi
}

hook_install_root() {
  realpath_dir "${CURSOR_HOME:-${HOME}/.cursor}/hooks"
}

resolve_root() {
  local root
  if [[ -n "${CURSOR_PROJECT_DIR:-}" ]]; then
    realpath_dir "$CURSOR_PROJECT_DIR"
    return
  fi
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  root="$(realpath_dir "$root")"
  local hooks
  hooks="$(hook_install_root)"
  if [[ "$root" == "$hooks" || "$root" == "$hooks/"* ]]; then
    return 2
  fi
  printf '%s\n' "$root"
}

root_resolution_response() {
  local msg="CURSOR_PROJECT_DIR missing; refusing to use global hooks directory as project root."
  case "$STEP" in
    stop)
      cgr_emit_stop_followup "cursor-goal: $msg"
      ;;
    beforeSubmitPrompt)
      if cgr_strict_enabled; then
        printf '{"continue":false,"user_message":"CURSOR_GOAL_STRICT=1: cursor-goal: %s"}\n' "$msg"
      else
        printf '{"continue":true}\n'
      fi
      ;;
    preToolUse|beforeShellExecution)
      printf '{"permission":"allow","agent_message":"cursor-goal: %s"}\n' "$msg"
      ;;
    sessionStart)
      printf '{"continue":true}\n'
      ;;
    *)
      printf '{}\n'
      ;;
  esac
}

if ! ROOT="$(resolve_root)"; then
  root_resolution_response
  exit 0
fi
GOAL_DIR="$ROOT/.cursor/goal"
mkdir -p "$GOAL_DIR/passports" "$GOAL_DIR/evidence"

normalize_file_path() {
  local f="${1//\\//}"
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
' "$f" 2>/dev/null || printf '%s' "$f"
    return 0
  fi
  jq -nr --arg p "$f" '
    def norm($path):
      ($path | gsub("/+"; "/")) as $compact |
      ($compact | startswith("/")) as $abs |
      ($compact | split("/") | reduce .[] as $part
        ([];
          if $part == "" or $part == "." then .
          elif $part == ".." then
            if length > 0 and .[-1] != ".." then .[0:length - 1]
            elif $abs then .
            else . + [".."] end
          else . + [$part] end
        )) as $parts |
      (if $abs then "/" else "" end) + ($parts | join("/")) |
      if . == "" then (if $abs then "/" else "." end) else . end;
    norm($p)
  '
}

relative_file_path() {
  local f
  local r
  f="$(normalize_file_path "$1")"
  r="$(normalize_file_path "$ROOT")"
  if [[ "$f" == "$r" ]]; then
    printf '.'
  elif [[ "$f" == "$r/"* ]]; then
    printf '%s' "${f#"$r/"}"
  else
    printf '%s' "$f"
  fi
}

path_inside_project() {
  local f
  local r
  f="$(normalize_file_path "$1")"
  r="$(normalize_file_path "$ROOT")"
  if [[ "$f" == /* ]]; then
    [[ "$f" == "$r" || "$f" == "$r/"* ]]
    return
  fi
  [[ "$f" != ".." && "$f" != ../* ]]
}

unit_id_from_path() {
  local f
  f="$(normalize_file_path "$1")"
  printf '%s' "$f" | sed -nE 's|(^|.*/)\.cursor/goal/evidence/units/([a-z0-9][a-z0-9_-]*)\.jsonl$|\2|Ip' | head -1
}

unit_evidence_path() {
  local f
  f="$(normalize_file_path "$1")"
  local id="$2"
  [[ "$id" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || return 1
  [[ -n "$id" && "$f" =~ (^|/)\.cursor/goal/evidence/units/${id}\.jsonl$ ]]
}

git_tree_id() {
  git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf 'no-git'
}

install_git_sha() {
  local manifest="${CURSOR_HOME:-${HOME}/.cursor}/cursor-goal/install-manifest.json"
  if [[ -f "$manifest" ]]; then
    jq -r '.git_sha // null' "$manifest" 2>/dev/null || printf 'null'
  else
    printf 'null'
  fi
}

last_jsonl_entry() {
  local file="$1"
  if [[ -f "$file" ]]; then
    tail -n 1 "$file" | jq -c '.' 2>/dev/null || printf 'null'
  else
    printf 'null'
  fi
}

case "$STEP" in
  sessionStart)
    rm -f "$GOAL_DIR/.warned-runtime-missing"
    if [[ ! -f "$ROOT/GOAL.md" ]]; then
      if [[ -f "$ROOT/.cursor/goal/templates/GOAL.md" ]]; then
        cp "$ROOT/.cursor/goal/templates/GOAL.md" "$ROOT/GOAL.md"
      elif [[ -f "${CURSOR_HOME:-${HOME}/.cursor}/goal/templates/GOAL.md" ]]; then
        cp "${CURSOR_HOME:-${HOME}/.cursor}/goal/templates/GOAL.md" "$ROOT/GOAL.md"
      fi
    fi
    if [[ ! -f "$GOAL_DIR/manifest.json" ]]; then
      LOOP_LIMIT="$(cgr_read_loop_limit "$ROOT")"
      echo "{\"goal_id\":\"default\",\"loop_limit\":$LOOP_LIMIT,\"runtime\":\"minimal\"}" > "$GOAL_DIR/manifest.json"
    fi
    if [[ ! -f "$GOAL_DIR/trajectory.json" ]]; then
      echo '{"phase":"DISCOVERY"}' > "$GOAL_DIR/trajectory.json"
    fi
    echo '{}'
    ;;
  beforeSubmitPrompt)
    # Minimal path: auto default — no GOAL required (full runtime does triage).
    if [[ -f "$GOAL_DIR/PAUSED" ]]; then
      echo '{"continue":true}'
      exit 0
    fi
    echo '{"continue":true}'
    ;;
  preToolUse)
    TOOL="$(echo "$INPUT" | jq -r '.tool_name // empty')"
    FILE="$(echo "$INPUT" | jq -r '.file_path // .tool_input.path // .tool_input.file_path // empty')"
    IS_SUB="$(echo "$INPUT" | jq -r '.is_subagent // false')"
    NORM_FILE=""
    if [[ -n "$FILE" ]]; then
      NORM_FILE="$(normalize_file_path "$FILE")"
    fi
    if [[ "$IS_SUB" == "true" ]] && [[ "$NORM_FILE" == ".cursor/goal" || "$NORM_FILE" == .cursor/goal/* || "$NORM_FILE" == */.cursor/goal || "$NORM_FILE" == */.cursor/goal/* ]]; then
      WUID="$(echo "$INPUT" | jq -r '.work_unit_id // .tool_input.work_unit_id // empty')"
      [[ -z "$WUID" ]] && WUID="$(unit_id_from_path "$FILE")"
      if unit_evidence_path "$FILE" "$WUID"; then
        if ! path_inside_project "$FILE"; then
          jq -n --arg m "Subagent WriteGate: $FILE outside project root" \
            '{permission:"deny",agent_message:$m}'
          exit 0
        fi
        echo '{"permission":"allow"}'
        exit 0
      fi
      jq -n --arg m "Subagents may only write evidence/units/<id>.jsonl under .cursor/goal" \
        '{permission:"deny",agent_message:$m}'
      exit 0
    fi
    if [[ "$IS_SUB" == "true" ]] && [[ -n "$FILE" ]] && [[ "$TOOL" == "Write" || "$TOOL" == "Edit" || "$TOOL" == "MultiEdit" ]] && [[ -f "$GOAL_DIR/work-units.json" ]]; then
      WUID="$(echo "$INPUT" | jq -r '.work_unit_id // .tool_input.work_unit_id // empty')"
      if ! path_inside_project "$FILE"; then
        jq -n --arg m "Subagent WriteGate: $FILE outside project root" \
          '{permission:"deny",agent_message:$m}'
        exit 0
      fi
      REL_FILE="$(relative_file_path "$FILE")"
      if [[ -z "$WUID" ]]; then
        WUID="$(unit_id_from_path "$REL_FILE")"
      fi
      if [[ -n "$WUID" ]]; then
        if unit_evidence_path "$REL_FILE" "$WUID"; then
          echo '{"permission":"allow"}'
          exit 0
        fi
        if ! jq -e 'type == "object" and (.units | type == "array")' "$GOAL_DIR/work-units.json" >/dev/null 2>&1; then
          printf '{"permission":"deny","agent_message":"Subagent WriteGate: work-units.json unreadable - cannot verify unit scope"}\n'
          exit 0
        fi
        IN_UNIT="$(jq -r --arg id "$WUID" --arg f "$REL_FILE" '
          .units[]? | select(.id == $id) | .scope[]? as $p |
          ($p | gsub("\\\\"; "/") | split("/") | reduce .[] as $part ([];
            if $part == "" or $part == "." then .
            elif $part == ".." then
              if length > 0 and .[-1] != ".." then .[0:length - 1]
              else . + [".."] end
            else . + [$part] end
          ) | join("/") | rtrimstr("/")) as $base |
          if $base == "**" or $base == "." or $base == "" or $f == $base or ($f | startswith($base + "/")) then "yes" else empty end
        ' "$GOAL_DIR/work-units.json" 2>/dev/null | head -1)"
        if [[ "$IN_UNIT" != "yes" ]]; then
          jq -n --arg m "Subagent WriteGate: $FILE outside unit $WUID scope" \
            '{permission:"deny",agent_message:$m}'
          exit 0
        fi
      elif ! unit_evidence_path "$REL_FILE" "$(unit_id_from_path "$REL_FILE")"; then
        jq -n --arg m "Subagent WriteGate: missing work_unit_id — cannot verify unit scope" \
          '{permission:"deny",agent_message:$m}'
        exit 0
      fi
    fi
    echo '{"permission":"allow"}'
    ;;
  beforeShellExecution)
    # Minimal mode is fail-open except for narrowly destructive commands.
    CMD="$(echo "$INPUT" | jq -r '.command // empty')"
    if destructive_shell "$CMD"; then
      jq -n --arg m "Destructive shell blocked by cursor-goal minimal policy." \
        '{permission:"deny",agent_message:$m}'
      exit 0
    fi
    echo '{"permission":"allow"}'
    ;;
  postToolUse)
    TOOL="$(echo "$INPUT" | jq -r '.tool_name // empty')"
    if [[ "$TOOL" == "Write" || "$TOOL" == "Edit" || "$TOOL" == "MultiEdit" ]]; then
      echo "{\"last_edit_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$GOAL_DIR/state.json"
    fi
    if [[ "$TOOL" == "Shell" ]]; then
      OUT="$(echo "$INPUT" | jq -r '.tool_output // empty' | head -c 500)"
      echo "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"tool\":\"Shell\",\"excerpt\":$(jq -Rn --arg x "$OUT" '$x')}" \
        >> "$GOAL_DIR/evidence/ledger.jsonl"
    fi
    echo '{}'
    ;;
  subagentStop)
    echo "$INPUT" | jq -c --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {at: $at}' \
      >> "$GOAL_DIR/evidence/subagents.jsonl" 2>/dev/null || true
    echo '{}'
    ;;
  sessionEnd)
    if [[ ! -f "$GOAL_DIR/passports/RELEASE.json" ]] && [[ ! -f "$GOAL_DIR/passports/SESSION_END.json" ]]; then
      LAST_STOP="$(last_jsonl_entry "$GOAL_DIR/stop-trace.jsonl")"
      LAST_CHECK="$(last_jsonl_entry "$GOAL_DIR/evidence/proof-runs.jsonl")"
      FAILURE_CLASS="release_missing"
      WHY="release passport missing"
      LAST_CHECK_OK="$(printf '%s' "$LAST_CHECK" | jq -r '.ok // empty' 2>/dev/null || true)"
      LAST_STOP_RESULT="$(printf '%s' "$LAST_STOP" | jq -r '.pipeline_result // empty' 2>/dev/null || true)"
      if [[ "$LAST_CHECK_OK" == "false" ]]; then
        LAST_CHECK_CMD="$(printf '%s' "$LAST_CHECK" | jq -r '.cmd // "unknown check"' 2>/dev/null || printf 'unknown check')"
        FAILURE_CLASS="checks_failed"
        WHY="last check failed ($LAST_CHECK_CMD)"
      elif [[ -n "$LAST_STOP_RESULT" && "$LAST_STOP_RESULT" != "release" ]]; then
        LAST_STOP_FAILED="$(printf '%s' "$LAST_STOP" | jq -r '.level_failed // .failures[0] // "unknown"' 2>/dev/null || printf 'unknown')"
        FAILURE_CLASS="stop_blocked"
        WHY="last stop did not release ($LAST_STOP_FAILED)"
      elif [[ "$LAST_CHECK_OK" == "true" ]]; then
        FAILURE_CLASS="green_but_unreleased"
        WHY="checks passed but RELEASE passport was not written"
      fi
      jq -n \
        --arg status "SESSION_END" \
        --arg reason "session_end_without_release" \
        --arg failure_class "$FAILURE_CLASS" \
        --arg root "$ROOT" \
        --arg git_tree "$(git_tree_id)" \
        --arg runtime_root "minimal" \
        --arg install_git_sha "$(install_git_sha)" \
        --arg why "$WHY" \
        --argjson last_stop_trace "$LAST_STOP" \
        --argjson last_check_result "$LAST_CHECK" \
        '{status:$status,reason:$reason,failure_class:$failure_class,root:$root,git_tree:$git_tree,runtime_root:$runtime_root,install_git_sha:$install_git_sha,why_no_release:$why,last_stop_trace:$last_stop_trace,last_check_result:$last_check_result}' \
        > "$GOAL_DIR/passports/SESSION_END.json"
    fi
    echo '{}'
    ;;
  preCompact)
    echo '{}'
    ;;
  *)
    echo '{}'
    ;;
esac
