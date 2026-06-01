import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { goalDir, passportsDir } from "./paths.js";
import { cursorHome } from "./template.js";
import { readSessionEndDiagnostics } from "./session-end-report.js";

export type Incident = {
  kind: string;
  source: string;
  at?: string;
  summary: string;
};

export type IncidentReport = {
  since: string;
  clusters: Record<string, number>;
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

function transcriptSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240) || "agent transcript failure";
}

function cluster(incidents: Incident[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of incidents) out[i.kind] = (out[i.kind] ?? 0) + 1;
  return out;
}

export async function buildIncidentReport(root: string, since = "today"): Promise<IncidentReport> {
  const start = startForSince(since);
  const incidents: Incident[] = [];
  const session = await readSessionEndDiagnostics(root);
  if (session && includeAt((session as { at?: string }).at, start)) {
    incidents.push({
      kind: session.failure_class ?? session.reason ?? "session_end_without_release",
      source: path.join(passportsDir(root), "SESSION_END.json"),
      at: (session as { at?: string }).at,
      summary: session.why_no_release ?? "session ended without release",
    });
  }

  for (const row of await readJsonl(path.join(goalDir(root), "evidence", "proof-runs.jsonl"))) {
    if (row.ok === false && includeAt(typeof row.at === "string" ? row.at : undefined, start)) {
      incidents.push({
        kind: row.timed_out ? "proof_run_timeout" : "proof_run_failed",
        source: "proof-runs.jsonl",
        at: typeof row.at === "string" ? row.at : undefined,
        summary: `${row.cmd ?? "unknown command"}`,
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
      incidents.push({ kind: "terminal_unknown_exit", source: file, at: started, summary: command });
    } else if (exit && exit !== "0") {
      incidents.push({ kind: "terminal_failed", source: file, at: started, summary: command });
    }
  }

  for (const file of cursorFiles.filter((candidate) => candidate.includes("/agent-transcripts/") && candidate.endsWith(".jsonl"))) {
    const rows = await readJsonl(file);
    for (const row of rows) {
      const text = stringsFrom(row).join("\n");
      if (!text.includes(root) && !text.includes(path.basename(root))) continue;
      const at = rowTime(row);
      if (!includeAt(at, start)) continue;
      if (/(stalled|timed out|exit_code\s*:?\s*unknown|cannot find module|failed|error)/i.test(text)) {
        incidents.push({
          kind: "agent_transcript_failure",
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
  return { since, clusters: cluster(incidents), incidents };
}

export function formatIncidentReport(report: IncidentReport): string {
  const lines = [`Incidents since ${report.since}`, ""];
  const clusters = Object.entries(report.clusters);
  if (!clusters.length) return `${lines[0]}\n\nNo incidents found.`;
  lines.push("Clusters:");
  for (const [kind, count] of clusters) lines.push(`- ${kind}: ${count}`);
  lines.push("", "Recent:");
  for (const incident of report.incidents.slice(0, 10)) {
    lines.push(`- ${incident.kind}: ${incident.summary}`);
  }
  return lines.join("\n");
}
