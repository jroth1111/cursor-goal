import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { compileGoalV2 } from "../compile/compile-v2.js";
import { goalDir, goalMd, projectRoot } from "./paths.js";
import { auditGoalAlignment } from "./goal-alignment.js";
import { readFile } from "node:fs/promises";
import { cursorHome } from "./template.js";
import { resolveRuntimeRoot as resolveRuntime } from "./resolve-runtime.js";
import { probeCursorAgentPreflight } from "./dispatch-verify.js";
import { auditGovernanceMismatch } from "./governance-doctor.js";
import { workingTreeFingerprint } from "./git-state.js";
import { readSessionMode } from "./governance-config.js";

export type DoctorIssue = { level: "error" | "warn"; message: string };

export type DoctorReport = {
  issues: DoctorIssue[];
  runtime_root: string | null;
  hooks: { global: boolean; project: boolean };
  agent_preflight?: ReturnType<typeof probeCursorAgentPreflight>;
};

export type DoctorOptions = {
  strict?: boolean;
};

type CursorHookEntry = {
  command?: unknown;
  timeout?: unknown;
};

type CursorHooksFile = {
  hooks?: Record<string, CursorHookEntry[]>;
};

function strictMode(options?: DoctorOptions): boolean {
  if (options?.strict) return true;
  return /^(1|true|yes)$/i.test(process.env.CURSOR_GOAL_STRICT ?? "");
}

export function resolveRuntimeRoot(root: string): string | null {
  return resolveRuntime(root);
}

export function hasProjectHooks(root: string): boolean {
  return existsSync(path.join(root, ".cursor/hooks/goal-stop.sh"));
}

export function hasGlobalHooks(): boolean {
  return existsSync(path.join(cursorHome(), "hooks/goal-stop.sh"));
}

function sourceHeadMatches(source: string, gitSha: string): boolean | null {
  const normalizedSha = gitSha.trim();
  if (normalizedSha.length < 7) return false;
  const r = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status !== 0) return null;
  return r.stdout.trim().startsWith(normalizedSha);
}

function sourceTreeMatches(source: string, sourceTree: string): boolean | null {
  if (!existsSync(source)) return null;
  try {
    return workingTreeFingerprint(source) === sourceTree;
  } catch {
    return null;
  }
}

async function readCursorHooksFile(file: string): Promise<CursorHooksFile | null> {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as CursorHooksFile;
  } catch {
    return null;
  }
}

function hookCommand(entry: CursorHookEntry): string {
  return typeof entry.command === "string" ? entry.command : "";
}

async function auditCursorHookSemantics(root: string): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const files = [
    { label: "project", file: path.join(root, ".cursor/hooks.json") },
    { label: "global", file: path.join(cursorHome(), "hooks.json") },
  ];

  for (const { label, file } of files) {
    const parsed = await readCursorHooksFile(file);
    const hooks = parsed?.hooks;
    if (!hooks) continue;

    const stop = Array.isArray(hooks.stop) ? hooks.stop : [];
    const cursorGoalStop = stop.filter((entry) =>
      /goal-stop\.sh|hook-stop\.mjs|cursor-goal/i.test(hookCommand(entry)),
    );
    if (cursorGoalStop.length > 1) {
      issues.push({
        level: "warn",
        message: `${label} hooks contain duplicate cursor-goal stop hook entries; Cursor runs hooks in parallel and merges followups`,
      });
    }
    for (const entry of cursorGoalStop) {
      const timeout = typeof entry.timeout === "number" ? entry.timeout : null;
      if (timeout !== null && timeout < 600) {
        issues.push({
          level: "warn",
          message: `${label} cursor-goal stop.timeout=${timeout}; set stop.timeout to at least 600 seconds`,
        });
      }
    }

    const preCompact = Array.isArray(hooks.preCompact) ? hooks.preCompact : [];
    for (const entry of preCompact) {
      const command = hookCommand(entry);
      if (/goal-precompact\.sh/i.test(command)) {
        issues.push({
          level: "warn",
          message: `${label} preCompact hook command looks stale (${command}); Cursor preCompact consumes user_message, use goal-pre-compact.sh from the current install`,
        });
      }
    }
  }

  return issues;
}

function objectHasCursorGoalHook(value: unknown): boolean {
  if (typeof value === "string") {
    return /cursor-goal|goal-[a-z-]+\.sh|hook-[a-zA-Z]+\.mjs/i.test(value);
  }
  if (Array.isArray(value)) return value.some((entry) => objectHasCursorGoalHook(entry));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      objectHasCursorGoalHook(entry),
    );
  }
  return false;
}

function cursorHooksHaveCursorGoal(parsed: CursorHooksFile | null): boolean {
  const hooks = parsed?.hooks;
  if (!hooks) return false;
  return Object.values(hooks).some((entries) =>
    Array.isArray(entries) &&
    entries.some((entry) => /cursor-goal|goal-[a-z-]+\.sh|hook-[a-zA-Z]+\.mjs/i.test(hookCommand(entry))),
  );
}

async function auditClaudeHookConflicts(root: string): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const cursorProjectHooks = await readCursorHooksFile(path.join(root, ".cursor/hooks.json"));
  const cursorGlobalHooks = await readCursorHooksFile(path.join(cursorHome(), "hooks.json"));
  const hasCursorGoalCursorHooks =
    cursorHooksHaveCursorGoal(cursorProjectHooks) || cursorHooksHaveCursorGoal(cursorGlobalHooks);
  if (!hasCursorGoalCursorHooks) return issues;

  for (const rel of [".claude/settings.json", ".claude/settings.local.json"]) {
    const file = path.join(root, rel);
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
      if (objectHasCursorGoalHook((parsed as { hooks?: unknown })?.hooks)) {
        issues.push({
          level: "warn",
          message:
            `${rel} also defines cursor-goal hooks; Cursor translates Claude settings into Cursor hooks, ` +
            "so remove the duplicate or keep only one hook source",
        });
      }
    } catch {
      issues.push({
        level: "warn",
        message: `${rel} is unreadable; cannot audit Claude hook conflicts`,
      });
    }
  }

  return issues;
}

export async function runDoctor(root = projectRoot(), options: DoctorOptions = {}): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const projectHooks = hasProjectHooks(root);
  const globalHooks = hasGlobalHooks();
  const strict = strictMode(options);

  if (!projectHooks && !globalHooks) {
    issues.push({
      level: "error",
      message:
        "Hooks missing — run: npm run install:global (or bash core/install.sh for per-repo hooks)",
    });
  } else if (globalHooks && !existsSync(path.join(cursorHome(), "cursor-goal-runtime/dist/hook-stop.mjs"))) {
    issues.push({
      level: "error",
      message: "Global runtime missing — run: npm run install:global",
    });
  }

  if (!resolveRuntimeRoot(root)) {
    issues.push({
      level: "error",
      message: "Runtime not built — run: npm run install:global or npm run build",
    });
  }
  if (!existsSync(goalMd(root))) {
    issues.push({ level: "warn", message: "GOAL.md missing — will auto-init on first session in git repos" });
  }
  if (!existsSync(path.join(goalDir(root), "manifest.json"))) {
    issues.push({ level: "warn", message: "Not compiled — run: cursor-goal compile" });
  }
  for (const stale of ["NEXT_UNIT.md", "LAST_CHECK_FAIL.md"]) {
    if (existsSync(path.join(goalDir(root), stale))) {
      issues.push({
        level: "warn",
        message: `Remove deprecated ${stale} — orchestration is in runtime-state.json`,
      });
    }
  }
  if (existsSync(goalMd(root))) {
    try {
      issues.push(...(await auditGoalAlignment(root)));
    } catch {
      issues.push({ level: "warn", message: "GOAL alignment audit failed — run: cursor-goal doctor" });
    }
  }

  const manifestPath = path.join(cursorHome(), "cursor-goal/install-manifest.json");
  const rt = resolveRuntimeRoot(root);
  if (globalHooks && existsSync(manifestPath) && rt) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        source?: string;
        git_sha?: string;
        source_tree?: string;
      };
      const pkgPath = path.join(rt, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
        const treeCurrent = manifest.source && manifest.source_tree
          ? sourceTreeMatches(manifest.source, manifest.source_tree)
          : undefined;
        const current = treeCurrent !== undefined
          ? treeCurrent
          : manifest.source && manifest.git_sha
            ? sourceHeadMatches(manifest.source, manifest.git_sha)
            : null;
        if (current === false && manifest.source_tree) {
          issues.push({
            level: strict ? "error" : "warn",
            message: `Global runtime source tree differs from installed manifest (${manifest.source_tree}) — run: cursor-goal upgrade`,
          });
        } else if (current === false) {
          issues.push({
            level: strict ? "error" : "warn",
            message: `Global runtime may be stale (installed from ${manifest.git_sha}) — run: cursor-goal upgrade`,
          });
        } else if (current === null) {
          issues.push({
            level: "warn",
            message: `Global install source unavailable (${manifest.source}) — run: npm run install:global from a current checkout`,
          });
        }
        void pkg.version;
      }
    } catch {
      issues.push({
        level: "warn",
        message:
          "Global install manifest unreadable — run: npm run install:global from a current checkout",
      });
    }
  }

  const preflight = probeCursorAgentPreflight();
  if (!preflight.available) {
    issues.push({
      level: "warn",
      message: `${preflight.bin} not available for dispatch --verify --spawn (status=${preflight.status ?? "n/a"}). Set CURSOR_AGENT_BIN or use --dry-run.`,
    });
  }

  try {
    issues.push(...(await auditGovernanceMismatch(root)));
  } catch {
    issues.push({ level: "warn", message: "Governance mismatch audit failed" });
  }

  try {
    const session = await readSessionMode(root);
    if (session?.mode === "governed" && !session.interaction_mode_hint) {
      issues.push({
        level: "warn",
        message:
          "Session mode is governed but missing interaction_mode_hint; refresh with /goal or cursor-goal mode governed",
      });
    }
    const authoritativeMode = session?.effective_mode ?? session?.mode;
    if (
      authoritativeMode === "governed" &&
      session?.interaction_mode_hint &&
      session.interaction_mode_hint !== "delivery"
    ) {
      issues.push({
        level: "warn",
        message:
          `Session mode is governed but interaction_mode_hint=${session.interaction_mode_hint}; ` +
          "refresh with /goal or cursor-goal mode governed",
      });
    }
  } catch {
    issues.push({ level: "warn", message: "Session mode consistency audit failed" });
  }

  if (!existsSync(path.join(goalDir(root), "agents"))) {
    issues.push({
      level: "warn",
      message: "No per-agent prompt-context artifacts found yet; governed prompt context extraction may be uninitialized",
    });
  }

  try {
    issues.push(...(await auditCursorHookSemantics(root)));
  } catch {
    issues.push({ level: "warn", message: "Cursor hook semantics audit failed" });
  }

  try {
    issues.push(...(await auditClaudeHookConflicts(root)));
  } catch {
    issues.push({ level: "warn", message: "Claude hook conflict audit failed" });
  }

  return issues;
}

export async function buildDoctorReport(root = projectRoot(), options: DoctorOptions = {}): Promise<DoctorReport> {
  const agent_preflight = probeCursorAgentPreflight();
  return {
    issues: await runDoctor(root, options),
    runtime_root: resolveRuntimeRoot(root),
    hooks: { global: hasGlobalHooks(), project: hasProjectHooks(root) },
    agent_preflight,
  };
}

export async function applyDoctorFixes(root = projectRoot()): Promise<string[]> {
  const actions: string[] = [];
  for (const stale of ["NEXT_UNIT.md", "LAST_CHECK_FAIL.md"]) {
    const file = path.join(goalDir(root), stale);
    if (existsSync(file)) {
      await unlink(file);
      actions.push(`removed ${stale}`);
    }
  }
  if (existsSync(goalMd(root)) && !existsSync(path.join(goalDir(root), "manifest.json"))) {
    await compileGoalV2(root);
    actions.push("compiled GOAL.md");
  }
  return actions;
}
