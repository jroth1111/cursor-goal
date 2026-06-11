import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { appendJournal } from "../src/lib/journal.js";
import { journalPath } from "../src/lib/paths.js";
import { formatJournalLine, runLogs } from "../src/driver/logs.js";
import { mkGitProject, type Project } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function seedJournal(p: Project): Promise<void> {
  await appendJournal(p.root, {
    at: "2026-06-10T10:00:01.000Z",
    kind: "lifecycle",
    note: "decomposed into 2 tasks via planner",
  });
  await appendJournal(p.root, {
    at: "2026-06-10T10:00:02.000Z",
    kind: "turn",
    task_id: "t1",
    global_turn: 1,
    terminal: "success",
    progressed: true,
    tokens: 1234,
    note: "CURRENT TASK (t1): build it",
  });
  await appendJournal(p.root, {
    at: "2026-06-10T10:00:03.000Z",
    kind: "decision",
    task_id: "t1",
    decision: "continue_same_session",
    note: "continue t1 (attempt 1)",
  });
  await appendJournal(p.root, {
    at: "2026-06-10T10:00:04.000Z",
    kind: "decision",
    task_id: "t2",
    decision: "task_done",
    note: "acceptance checks pass for t2",
  });
  // forward-compat: an unknown kind and a malformed line must render, not crash
  appendFileSync(
    journalPath(p.root),
    `${JSON.stringify({ at: "2026-06-10T10:00:05.000Z", kind: "telemetry", note: "from the future" })}\n` +
      "this line is not json\n",
  );
}

async function collect(p: Project, opts: Parameters<typeof runLogs>[1] = {}): Promise<string[]> {
  const out: string[] = [];
  await runLogs(p.root, opts, (l) => out.push(l.trimEnd()));
  return out;
}

describe("agent-driver logs", () => {
  it("renders every kind, unknown kinds raw-ish, malformed lines marked raw", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    await seedJournal(p);
    const out = await collect(p);
    expect(out).toHaveLength(6);
    expect(out[0]).toMatch(/^10:00:01 {2}lifecycle\s+decomposed into 2 tasks/);
    expect(out[1]).toMatch(/^10:00:02 {2}turn\s+t1 #1 \[success\] changed tok=1234 CURRENT TASK/);
    expect(out[2]).toMatch(/^10:00:03 {2}decision\s+t1 continue_same_session — continue t1/);
    expect(out[4]).toMatch(/telemetry/); // unknown kind keeps its raw JSON
    expect(out[4]).toMatch(/from the future/);
    expect(out[5]).toMatch(/^\?\?:\?\?:\?\? {2}raw\s+this line is not json/);
  });

  it("--task and --kind filter; malformed lines never match a filter", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    await seedJournal(p);
    const t1 = await collect(p, { task: "t1" });
    expect(t1).toHaveLength(2);
    expect(t1.every((l) => /t1/.test(l))).toBe(true);
    const decisions = await collect(p, { kind: "decision" });
    expect(decisions).toHaveLength(2);
    const both = await collect(p, { kind: "decision", task: "t2" });
    expect(both).toHaveLength(1);
    expect(both[0]).toMatch(/task_done/);
  });

  it("--tail keeps the last N after filtering; --tail 0 prints nothing (not everything)", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    await seedJournal(p);
    const out = await collect(p, { tail: 2 });
    expect(out).toHaveLength(2);
    expect(out[1]).toMatch(/raw/);
    const lastDecision = await collect(p, { kind: "decision", tail: 1 });
    expect(lastDecision).toHaveLength(1);
    expect(lastDecision[0]).toMatch(/task_done/);
    // slice(-0) is slice(0): without the explicit zero-guard this was the whole journal
    expect(await collect(p, { tail: 0 })).toEqual([]);
  });

  it("--follow rebases when the journal shrinks (reset + new run replaces the file)", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    await seedJournal(p);

    const out: string[] = [];
    const ctl = new AbortController();
    const done = runLogs(p.root, { follow: true, pollMs: 20, signal: ctl.signal }, (l) =>
      out.push(l.trimEnd()),
    );
    await new Promise((r) => setTimeout(r, 40));
    const initial = out.length;

    // a reset + fresh run replaces the journal with a SMALLER file; a stale byte
    // offset would stay silent until the new file outgrew it, then emit garbage
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      journalPath(p.root),
      `${JSON.stringify({ at: "2026-06-11T09:00:00.000Z", kind: "lifecycle", note: "fresh run after reset" })}\n`,
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(out.length).toBeGreaterThan(initial);
    expect(out[out.length - 1]).toMatch(/fresh run after reset/);
    ctl.abort();
    await done;
  });

  it("missing journal explains instead of erroring", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    const out = await collect(p);
    expect(out).toEqual(["No driver journal in this repo."]);
  });

  it("--follow emits lines appended after the initial read (partial lines buffered)", async () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    await seedJournal(p);
    mkdirSync(path.dirname(journalPath(p.root)), { recursive: true });

    const out: string[] = [];
    const ctl = new AbortController();
    const done = runLogs(p.root, { follow: true, pollMs: 20, signal: ctl.signal }, (l) =>
      out.push(l.trimEnd()),
    );
    await new Promise((r) => setTimeout(r, 40));
    const initial = out.length;
    // append a complete line and a partial line; the partial must wait for its newline
    appendFileSync(
      journalPath(p.root),
      `${JSON.stringify({ at: "2026-06-10T10:00:06.000Z", kind: "lifecycle", note: "appended live" })}\n`,
    );
    appendFileSync(journalPath(p.root), '{"at":"2026-06-10T10:00:07.000Z","kind":"lifec');
    await new Promise((r) => setTimeout(r, 80));
    expect(out.length).toBe(initial + 1);
    expect(out[out.length - 1]).toMatch(/appended live/);
    // complete the partial line; it should now arrive
    appendFileSync(journalPath(p.root), 'ycle","note":"second half"}\n');
    await new Promise((r) => setTimeout(r, 80));
    expect(out[out.length - 1]).toMatch(/second half/);
    ctl.abort();
    await done;
  });

  it("formatJournalLine never throws on garbage", () => {
    expect(formatJournalLine("")).toBeNull();
    expect(formatJournalLine("   ")).toBeNull();
    expect(formatJournalLine("{}")).toMatch(/unknown/);
    expect(formatJournalLine('{"kind":42}')).toMatch(/unknown/);
  });
});
