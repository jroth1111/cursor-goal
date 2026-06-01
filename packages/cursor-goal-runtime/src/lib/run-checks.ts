import { execSync } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { goalDir } from "./paths.js";
import { gitTreeId, readState, writeState } from "./git-state.js";
import { shellCommandAllowed } from "./shell-allow.js";

export type CheckResult = { cmd: string; ok: boolean; tree: string; output?: string };
export type CheckProfile = "fast" | "full" | "all";

export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

const PROOF_CACHE_TTL_MS = 15 * 60 * 1000;

export type RunChecksOptions = {
  profile?: CheckProfile;
  tiers?: Record<string, "fast" | "full">;
  useCache?: boolean;
};

function captureExecError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const text = [e.stderr, e.stdout, e.message].filter(Boolean).join("\n");
    if (text) return text.slice(0, 4000);
  }
  return String(err).slice(0, 4000);
}

export function checkTimeoutMs(): number {
  const raw = process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;
  if (raw === "0") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHECK_TIMEOUT_MS;
}

export function resolveStopCheckProfile(loopCount: number): CheckProfile {
  const raw = (process.env.CURSOR_GOAL_STOP_CHECK_PROFILE ?? "").toLowerCase();
  if (raw === "fast" || raw === "all") return raw;
  if (raw === "full") return "all";
  return loopCount > 0 ? "fast" : "all";
}

export function filterCommandsForProfile(
  commands: string[],
  tiers: Record<string, "fast" | "full"> | undefined,
  profile: CheckProfile,
): string[] {
  if (profile === "all") return commands;
  return commands.filter((cmd) => {
    const tier = tiers?.[cmd] ?? "full";
    if (profile === "fast") return tier === "fast";
    return tier === "full";
  });
}

type ProofCacheRow = { cmd: string; ok: boolean; tree: string; at: string };

async function readProofCache(root: string, tree: string): Promise<Map<string, ProofCacheRow>> {
  const state = await readState(root);
  const rows = (state as { last_proof_results?: ProofCacheRow[] }).last_proof_results ?? [];
  const map = new Map<string, ProofCacheRow>();
  const now = Date.now();
  for (const row of rows) {
    if (row.tree !== tree) continue;
    const age = now - Date.parse(row.at);
    if (!Number.isFinite(age) || age > PROOF_CACHE_TTL_MS) continue;
    map.set(row.cmd, row);
  }
  return map;
}

async function writeProofCache(root: string, tree: string, results: CheckResult[]): Promise<void> {
  const rows: ProofCacheRow[] = results.map((r) => ({
    cmd: r.cmd,
    ok: r.ok,
    tree: r.tree,
    at: new Date().toISOString(),
  }));
  await writeState(root, { last_proof_results: rows } as Record<string, unknown>);
}

export async function runChecks(
  root: string,
  commands: string[],
  options: RunChecksOptions = {},
): Promise<CheckResult[]> {
  const profile = options.profile ?? "all";
  const tiers = options.tiers;
  const filtered = filterCommandsForProfile(commands, tiers, profile);
  const tree = gitTreeId(root);
  const timeoutMs = checkTimeoutMs();
  const results: CheckResult[] = [];
  const proofRunsPath = path.join(goalDir(root), "evidence", "proof-runs.jsonl");
  await mkdir(path.dirname(proofRunsPath), { recursive: true });

  const cache =
    options.useCache && profile === "fast"
      ? await readProofCache(root, tree)
      : new Map<string, ProofCacheRow>();

  for (const cmd of filtered) {
    const cached = cache.get(cmd);
    if (cached) {
      results.push({ cmd, ok: cached.ok, tree: cached.tree });
      continue;
    }

    let ok = false;
    let output = "";
    if (!shellCommandAllowed(cmd)) {
      output = "Destructive command blocked by cursor-goal-runtime.";
    } else {
      try {
        execSync(cmd, {
          cwd: root,
          stdio: "pipe",
          encoding: "utf8",
          shell: "/bin/bash",
          ...(timeoutMs > 0 ? { timeout: timeoutMs, killSignal: "SIGKILL" } : {}),
        });
        ok = true;
      } catch (err) {
        ok = false;
        output = captureExecError(err);
        const e = err as { code?: string; signal?: string; killed?: boolean };
        if (
          timeoutMs > 0 &&
          (e?.code === "ETIMEDOUT" || e?.signal === "SIGKILL" || e?.signal === "SIGTERM" || e?.killed)
        ) {
          const source = process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS ? "CURSOR_GOAL_CHECK_TIMEOUT_MS" : "default";
          output = `check timed out after ${timeoutMs}ms (${source})\n${output}`;
        }
      }
    }
    const row = { cmd, ok, tree, ...(output ? { output } : {}) };
    results.push(row);
    await appendFile(
      proofRunsPath,
      JSON.stringify({ at: new Date().toISOString(), cmd, ok, tree, output: output || undefined }) +
        "\n",
      "utf8",
    );
  }

  if (options.useCache && profile === "fast" && results.length) {
    await writeProofCache(root, tree, results);
  }

  return results;
}
