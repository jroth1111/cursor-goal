import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { goalDir, passportsDir } from "./paths.js";
import { cursorHome } from "./template.js";
import { readSessionEndDiagnostics } from "./session-end-report.js";
import { readStopTraceTail, sumTokenUsage } from "./stop-trace.js";

export type Incident = {
  kind: string;
  signature?: string;
  source: string;
  at?: string;
  summary: string;
  token_cost?: { input: number; output: number };
  stop_loop_index?: number;
};

export type IncidentReport = {
  since: string;
  clusters: Record<string, number>;
  signature_clusters?: Record<string, number>;
  token_summary?: { input: number; output: number; cache_read: number; cache_write: number };
  incidents: Incident[];
};

export class InvalidIncidentsSinceError extends Error {
  constructor(since: string) {
    super(`Invalid --since value: ${since}. Use today, all, or an ISO date/time.`);
    this.name = "InvalidIncidentsSinceError";
  }
}

function startForSince(since: string): number {
  if (since === "all") return 0;
  if (since === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const t = Date.parse(since);
  if (!Number.isFinite(t)) {
    throw new InvalidIncidentsSinceError(since);
  }
  return t;
}

function includeAt(at: string | undefined, start: number): boolean {
  if (!start) return true;
  if (!at) return false;
  const t = Date.parse(at);
  return Number.isNaN(t) ? false : t >= start;
}

async function readJsonl(file: string): Promise<Record<string, unknown>[]> {
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  return out;
}

async function walkFiles(dir: string, limit = 500, extensions = new Set([".txt"])): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const p = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && extensions.has(path.extname(entry.name))) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

async function candidateCursorProjectDirs(root: string): Promise<string[]> {
  const projects = path.join(cursorHome(), "projects");
  const encoded = root.replace(/^\/+/, "").replace(/\//g, "-");
  const preferred = path.join(projects, encoded);
  if (existsSync(preferred)) return [preferred];
  try {
    const entries = await readdir(projects, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(projects, entry.name));
  } catch {
    return [];
  }
}

function stringsFrom(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsFrom(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringsFrom(item, out);
  }
  return out;
}

function rowTime(row: Record<string, unknown>): string | undefined {
  for (const key of ["timestamp", "at", "created_at", "time"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function redactUserFilePaths(text: string): string {
  if (!text.includes("/") && !text.includes("\\")) return text;
  const truncated = text.length > 4096;
  const slice = truncated ? text.slice(0, 4096) : text;
  const redacted = slice.replace(
    /(?:file:\/\/)?(?:[a-zA-Z]:)?(?=[\w./\\-]*[/\\])[\w./\\-]+/g,
    "<REDACTED: user-file-path>",
  );
  return truncated ? `${redacted} ... <REDACTED: truncated>` : redacted;
}

function transcriptSummary(text: string): string {
  return redactUserFilePaths(text).replace(/\s+/g, " ").trim().slice(0, 240) || "agent transcript failure";
}

function cluster(incidents: Incident[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of incidents) out[i.kind] = (out[i.kind] ?? 0) + 1;
  return out;
}

function signatureCluster(incidents: Incident[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of incidents) {
    if (!i.signature) continue;
    out[i.signature] = (out[i.signature] ?? 0) + 1;
  }
  return out;
}

function commandKey(command: string): string {
  const cleaned = redactUserFilePaths(command)
    .replace(/<REDACTED: user-file-path>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens[0] === "npm" && tokens[1] === "run" && tokens[2]) return `npm run ${tokens[2]}`;
  if (tokens[0] === "npm" && tokens[1]) return `npm ${tokens[1]}`;
  if (tokens[0] === "npx" && tokens[1]) return `npx ${tokens[1]}`;
  if (tokens[0] === "node") return "node";
  return tokens[0] ?? "unknown";
}

function staleProofDeltaKind(summary: string): string {
  const s = summary.toLowerCase();
  if (s.includes("fingerprint") || s.includes("tree") || s.includes("proof")) {
    return "fingerprint_delta";
  }
  if (s.includes("check")) return "check_delta";
  return "unknown_delta";
}

function hookChannelMismatchKey(summary: string): string | null {
  const match = summary.match(
    /hook[_ -]?channel[_ -]?mismatch[^A-Za-z]*(beforeSubmitPrompt|stop|sessionStart|preToolUse|beforeShellExecution|postToolUse|subagentStop|preCompact|sessionEnd|afterAgentResponse|[a-z][A-Za-z0-9_-]*)/i,
  );
  return match?.[1] ? `hook_channel_mismatch:${match[1]}` : null;
}

function incidentSignature(kind: string, summary: string): string {
  const s = summary.toLowerCase();
  const hookMismatch = hookChannelMismatchKey(summary);
  if (hookMismatch) return hookMismatch;
  if (kind === "proof_run_timeout") return `check_timeout:${commandKey(summary)}`;
  if (kind === "proof_run_failed") return `check_failed:${commandKey(summary)}`;
  if (kind === "stale_proof" || s.includes("stale-proof") || s.includes("stale proof")) {
    return `stale_proof:${staleProofDeltaKind(summary)}`;
  }
  if (kind === "terminal_unknown_exit") return "terminal:unknown_exit";
  if (kind === "terminal_failed") return "terminal:failed";
  if (kind === "agent_transcript_failure") {
    if (s.includes("cannot find module")) return "agent:module_not_found";
    if (s.includes("timed out")) return "agent:timeout";
    if (s.includes("stalled")) return "agent:stalled";
    return "agent:failure";
  }
  if (kind === "green_but_unreleased") return "session:green_but_unreleased";
  return `generic:${kind}`;
}

export async function buildIncidentReport(root: string, since = "today"): Promise<IncidentReport> {
  const start = startForSince(since);
  const incidents: Incident[] = [];

  // Read stop traces once for token cost correlation.
  const traces = await readStopTraceTail(root, 100);
  const tokenSummary = sumTokenUsage(traces);

  const session = await readSessionEndDiagnostics(root);
  if (session && includeAt((session as { at?: string }).at, start)) {
    const kind = session.failure_class ?? session.reason ?? "session_end_without_release";
    const summary = session.why_no_release ?? "session ended without release";
    incidents.push({
      kind,
      signature: incidentSignature(kind, summary),
      source: path.join(passportsDir(root), "SESSION_END.json"),
      at: (session as { at?: string }).at,
      summary,
      token_cost: (tokenSummary.input || tokenSummary.output) ? { input: tokenSummary.input, output: tokenSummary.output } : undefined,
    });
  }

  for (const row of await readJsonl(path.join(goalDir(root), "evidence", "proof-runs.jsonl"))) {
    if (row.ok === false && includeAt(typeof row.at === "string" ? row.at : undefined, start)) {
      const kind = row.timed_out ? "proof_run_timeout" : "proof_run_failed";
      const summary = redactUserFilePaths(`${row.cmd ?? "unknown command"}`);
      incidents.push({
        kind,
        signature: incidentSignature(kind, `${row.cmd ?? "unknown command"}`),
        source: "proof-runs.jsonl",
        at: typeof row.at === "string" ? row.at : undefined,
        summary,
      });
    }
  }

  const cursorProjectDirs = await candidateCursorProjectDirs(root);
  const cursorFiles = (
    await Promise.all(cursorProjectDirs.map((dir) => walkFiles(dir, 20_000, new Set([".txt", ".jsonl"]))))
  ).flat();

  for (const file of cursorFiles.filter((candidate) => candidate.endsWith(".txt"))) {
    const raw = await readFile(file, "utf8").catch(() => "");
    if (!raw.includes(root) && !raw.includes(path.basename(root))) continue;
    const started = raw.match(/^started_at:\s*(.+)$/m)?.[1]?.trim();
    if (!includeAt(started, start)) continue;
    const exit = raw.match(/^exit_code:\s*(.+)$/m)?.[1]?.trim();
    const command = raw.match(/^command:\s*"?(.*?)"?$/m)?.[1]?.trim() ?? "unknown command";
    if (exit === "unknown") {
      incidents.push({
        kind: "terminal_unknown_exit",
        signature: incidentSignature("terminal_unknown_exit", command),
        source: file,
        at: started,
        summary: redactUserFilePaths(command),
      });
    } else if (exit && exit !== "0") {
      incidents.push({
        kind: "terminal_failed",
        signature: incidentSignature("terminal_failed", command),
        source: file,
        at: started,
        summary: redactUserFilePaths(command),
      });
    }
  }

  for (const file of cursorFiles.filter((candidate) => candidate.includes("/agent-transcripts/") && candidate.endsWith(".jsonl"))) {
    const rows = await readJsonl(file);
    for (const row of rows) {
      const text = stringsFrom(row).join("\n");
      if (!text.includes(root) && !text.includes(path.basename(root))) continue;
      const at = rowTime(row);
      if (!includeAt(at, start)) continue;
      if (/(stalled|timed out|exit_code\s*:?\s*unknown|cannot find module|failed|error|hook[_ -]?channel[_ -]?mismatch)/i.test(text)) {
        incidents.push({
          kind: "agent_transcript_failure",
          signature: incidentSignature("agent_transcript_failure", text),
          source: file,
          at,
          summary: transcriptSummary(text),
        });
        break;
      }
    }
  }

  incidents.sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0;
    const tb = b.at ? Date.parse(b.at) : 0;
    return tb - ta;
  });
  return {
    since,
    clusters: cluster(incidents),
    signature_clusters: signatureCluster(incidents),
    token_summary: (tokenSummary.input || tokenSummary.output) ? tokenSummary : undefined,
    incidents,
  };
}

function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
}

export function formatIncidentReport(report: IncidentReport): string {
  const lines = [`Incidents since ${report.since}`, ""];
  const clusters = Object.entries(report.clusters);
  if (!clusters.length) return `${lines[0]}\n\nNo incidents found.`;
  lines.push("Clusters:");
  for (const [kind, count] of clusters) lines.push(`- ${kind}: ${count}`);
  if (report.token_summary) {
    const ts = report.token_summary;
    lines.push(`- token_cost: in=${fmtTokens(ts.input)} out=${fmtTokens(ts.output)}`);
  }
  lines.push("", "Recent:");
  for (const incident of report.incidents.slice(0, 10)) {
    const cost = incident.token_cost ? ` (in=${fmtTokens(incident.token_cost.input)} out=${fmtTokens(incident.token_cost.output)})` : "";
    lines.push(`- ${incident.kind}: ${incident.summary}${cost}`);
  }
  return lines.join("\n");
}
