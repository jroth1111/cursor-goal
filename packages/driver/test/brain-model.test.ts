import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildAgentArgs, type TurnResult } from "../src/agent/runner.js";
import { runGoal } from "../src/driver/loop.js";
import { readJournalTail } from "../src/lib/journal.js";
import { mkGitProject, type Project } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function project(driverLines: string[] = []): Project {
  const goalMd = [
    "# Goal",
    "",
    "## Goal",
    "Brain routing",
    "",
    "## Checks",
    "",
    "- `test -f out.txt`",
    ...(driverLines.length ? ["", "## Driver", "", ...driverLines] : []),
    "",
  ].join("\n");
  const p = mkGitProject({ "GOAL.md": goalMd });
  cleanups.push(p.cleanup);
  return p;
}

const plan = {
  tasks: [{ id: "t1", title: "t1", kind: "implement", deps: [], acceptance_checks: ["test -f out.txt"], acceptance_prose: "" }],
};

type Seen = Array<{ mode: string; model: string | null | undefined }>;

function makeCall(p: Project, seen: Seen) {
  let editTurn = 0;
  return async (opts: { mode?: string; model?: string | null }): Promise<TurnResult> => {
    seen.push({ mode: opts.mode ?? "edit", model: opts.model });
    if (opts.mode === "ask") {
      // first ask = decompose; later asks = verdict
      const payload =
        seen.filter((s) => s.mode === "ask").length === 1
          ? plan
          : { task_complete: false, confidence: 0.3, blockers: [], next_action: { kind: "continue", instruction: "write it" } };
      return { sessionId: "ask", finalText: JSON.stringify(payload), usage: null, terminal: "success", exitCode: 0, timedOut: false };
    }
    editTurn += 1;
    if (editTurn >= 2) writeFileSync(path.join(p.root, "out.txt"), "x");
    return { sessionId: "s", finalText: "ok", usage: null, terminal: "success", exitCode: 0, timedOut: false };
  };
}

describe("brain-model routing", () => {
  it("ask-mode brain calls carry the brain model; edit turns keep the primary model", async () => {
    const p = project();
    const seen: Seen = [];
    const result = await runGoal({
      root: p.root,
      model: "strong-model",
      brainModel: "cheap-brain",
      budgets: { global_turns: 6, review_rounds: 0 },
      call: makeCall(p, seen),
    });
    expect(result.status).toBe("done");
    const asks = seen.filter((s) => s.mode === "ask");
    expect(asks.length).toBeGreaterThanOrEqual(2); // decompose + at least one verdict
    for (const a of asks) expect(a.model).toBe("cheap-brain");
    const edits = seen.filter((s) => s.mode === "edit");
    for (const e of edits) expect(e.model).toBe("strong-model");

    const journal = await readJournalTail(p.root, 50);
    expect(journal.some((e) => /brain model: cheap-brain \(edit turns: strong-model\)/.test(e.note ?? ""))).toBe(true);
  });

  it("unset knob = exact passthrough: ask calls carry no model and the argv is byte-identical", async () => {
    const p = project();
    const seen: Seen = [];
    const result = await runGoal({
      root: p.root,
      budgets: { global_turns: 6, review_rounds: 0 },
      call: makeCall(p, seen),
    });
    expect(result.status).toBe("done");
    for (const a of seen.filter((s) => s.mode === "ask")) expect(a.model == null).toBe(true);

    // byte-identical argv for a brain call with and without the (unset) knob
    const base = { instruction: "judge", mode: "ask" as const, root: p.root };
    expect(buildAgentArgs(base)).toEqual(buildAgentArgs({ ...base, model: undefined }));
    expect(buildAgentArgs(base)).toEqual(["--print", "--output-format", "stream-json", "--stream-partial-output", "--mode", "ask", "--trust", "judge"]);

    const journal = await readJournalTail(p.root, 50);
    expect(journal.some((e) => /brain model:/.test(e.note ?? ""))).toBe(false);
  });

  it("GOAL.md Driver brain_model is the config home; the flag would override it", async () => {
    const p = project(["- brain_model: file-brain"]);
    const seen: Seen = [];
    const result = await runGoal({
      root: p.root,
      budgets: { global_turns: 6, review_rounds: 0 },
      call: makeCall(p, seen),
    });
    expect(result.status).toBe("done");
    for (const a of seen.filter((s) => s.mode === "ask")) expect(a.model).toBe("file-brain");
    // edit turns: no primary model given -> agent default (no model injected)
    for (const e of seen.filter((s) => s.mode === "edit")) expect(e.model == null).toBe(true);
  });
});
