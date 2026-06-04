import { describe, it, expect } from "vitest";
import { buildUnitTaskPrompt } from "../src/lib/stop-playbook.js";
import { formatFollowupMessage } from "../src/lib/runtime-state.js";

describe("stop followup formatting", () => {
  it("buildUnitTaskPrompt includes work_unit_id", () => {
    const p = buildUnitTaskPrompt({
      id: "auth",
      title: "Auth",
      scope: ["src/auth/"],
      acceptance: ["npm test"],
      status: "pending",
      subagent_id: null,
      evidence_path: "evidence/units/auth.jsonl",
    });
    expect(p).toContain("work_unit_id: auth");
    expect(p).toContain("src/auth/");
  });

  it("formatFollowupMessage lists next unit dispatch", () => {
    const msg = formatFollowupMessage({
      mode: "runtime",
      loop_count: 1,
      loop_limit: 40,
      phase: "VERIFY",
      blocked: true,
      blockers: ["units:open"],
      next_action: {
        kind: "dispatch_unit",
        headline: 'Dispatch work unit "mod-a"',
        detail: "Spawn one Task/subagent with the task_prompt below.",
        task_prompt: "work_unit_id: mod-a\nScope: pkg/a/",
        unit_id: "mod-a",
        queue_index: 0,
      },
      last_check_fail: null,
      updated_at: new Date().toISOString(),
    });
    expect(msg).toContain("Next action (do this first)");
    expect(msg).not.toContain("work_unit_id: mod-a");
    expect(msg).toContain("inspect the full task prompt with cursor-goal next");
    expect(msg).toContain("agents/default/runtime-state.json");
  });
});
