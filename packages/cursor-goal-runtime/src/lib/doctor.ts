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

export type DoctorIssue = { level: "error" | "warn"; message: string };

export type DoctorReport = {
  issues: DoctorIssue[];
  runtime_root: string | null;
  hooks: { global: boolean; project: boolean };
};

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

export async function runDoctor(root = projectRoot()): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const projectHooks = hasProjectHooks(root);
  const globalHooks = hasGlobalHooks();

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
      };
      const pkgPath = path.join(rt, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
        const current = manifest.source && manifest.git_sha
          ? sourceHeadMatches(manifest.source, manifest.git_sha)
          : null;
        if (current === false) {
          issues.push({
            level: "warn",
            message: `Global runtime may be stale (installed from ${manifest.git_sha}) — run: cursor-goal upgrade`,
          });
        }
        void pkg.version;
      }
    } catch {
      /* ignore manifest parse */
    }
  }

  return issues;
}

export async function buildDoctorReport(root = projectRoot()): Promise<DoctorReport> {
  return {
    issues: await runDoctor(root),
    runtime_root: resolveRuntimeRoot(root),
    hooks: { global: hasGlobalHooks(), project: hasProjectHooks(root) },
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
