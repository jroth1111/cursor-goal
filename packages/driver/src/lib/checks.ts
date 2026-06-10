import { execSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { driverDir, evidenceDir } from "./paths.js";
import { gitTreeId } from "./git.js";
import { matchDestructiveRule } from "./shell-allow.js";
import {
  PREVIEW,
  PROOF_RUNS_ARTIFACT,
  progressiveReveal,
  revealForPrompt,
  withArtifactRef,
} from "./progressive-reveal.js";

export type CheckResult = { cmd: string; ok: boolean; tree: string; output?: string };

export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const PROOF_CACHE_TTL_MS = 15 * 60 * 1000;

function captureExecError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const text = [e.stderr, e.stdout, e.message].filter(Boolean).join("\n");
    if (text) return text;
  }
  return String(err);
}

export function checkTimeoutMs(): number {
  const raw = process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;
  if (raw === "0") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHECK_TIMEOUT_MS;
}

type ProofCacheRow = { cmd: string; ok: boolean; tree: string; at: string };

function proofCachePath(root: string): string {
  return path.join(driverDir(root), "proof-cache.json");
}

async function readProofCache(root: string, tree: string): Promise<Map<string, ProofCacheRow>> {
  const map = new Map<string, ProofCacheRow>();
  const file = proofCachePath(root);
  if (!existsSync(file)) return map;
  let rows: ProofCacheRow[] = [];
  try {
    rows = JSON.parse(await readFile(file, "utf8")) as ProofCacheRow[];
  } catch {
    return map;
  }
  const now = Date.now();
  for (const row of rows) {
    if (row.tree !== tree) continue;
    const age = now - Date.parse(row.at);
    if (!Number.isFinite(age) || age > PROOF_CACHE_TTL_MS) continue;
    map.set(row.cmd, row);
  }
  return map;
}

async function writeProofCache(root: string, results: CheckResult[]): Promise<void> {
  const rows: ProofCacheRow[] = results.map((r) => ({
    cmd: r.cmd,
    ok: r.ok,
    tree: r.tree,
    at: new Date().toISOString(),
  }));
  await mkdir(driverDir(root), { recursive: true });
  await writeFile(proofCachePath(root), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

export type RunChecksOptions = { useCache?: boolean };

/**
 * Run acceptance check commands, capturing output. Results are cached by the
 * working-tree fingerprint: an unchanged tree never re-pays for a passing suite.
 * Destructive commands are refused (defense in depth with the safety-net hook).
 */
export async function runChecks(
  root: string,
  commands: string[],
  options: RunChecksOptions = {},
): Promise<CheckResult[]> {
  const tree = gitTreeId(root);
  const timeoutMs = checkTimeoutMs();
  const results: CheckResult[] = [];
  const proofRunsPath = path.join(evidenceDir(root), "proof-runs.jsonl");
  await mkdir(path.dirname(proofRunsPath), { recursive: true });

  const cache = options.useCache ? await readProofCache(root, tree) : new Map<string, ProofCacheRow>();

  for (const cmd of commands) {
    const cached = cache.get(cmd);
    if (cached) {
      results.push({ cmd, ok: cached.ok, tree: cached.tree });
      continue;
    }

    let ok = false;
    let output = "";
    const denied = matchDestructiveRule(cmd);
    if (denied) {
      output = `Destructive command blocked by policy rule: ${denied}.`;
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
          output = `check timed out after ${timeoutMs}ms\n${output}`;
        }
      }
    }
    const row: CheckResult = { cmd, ok, tree, ...(output ? { output } : {}) };
    results.push(row);
    await appendFile(
      proofRunsPath,
      `${JSON.stringify({ at: new Date().toISOString(), cmd, ok, tree, output: output || undefined })}\n`,
      "utf8",
    );
  }

  if (options.useCache && results.length) await writeProofCache(root, results);
  return results;
}

export function allPass(results: CheckResult[]): boolean {
  return results.length > 0 && results.every((r) => r.ok);
}

/** Last failing check output — preview for the agent; full rows live in proof-runs.jsonl. */
export function failingTail(results: CheckResult[]): string {
  const failed = results.filter((r) => !r.ok);
  if (!failed.length) return "";
  const chunks = failed.map((r) => {
    const cmd = `$ ${r.cmd}`;
    const body = revealForPrompt(r.output ?? "", { maxChars: PREVIEW.CHECK_FAIL, tail: true }, PROOF_RUNS_ARTIFACT);
    return `${cmd}\n${body}`;
  });
  const joined = chunks.join("\n---\n");
  const total = progressiveReveal(joined, { maxChars: PREVIEW.FAILING_TAIL_TOTAL, tail: true });
  if (!total.truncated) return joined;
  return withArtifactRef(total.preview, PROOF_RUNS_ARTIFACT, true, total.byteCount);
}
