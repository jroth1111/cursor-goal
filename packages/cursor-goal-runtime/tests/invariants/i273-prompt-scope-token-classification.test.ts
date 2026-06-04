import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { extractPromptPathRefs } from "../../src/lib/prompt-context.js";
import { formatGovernedSubmitHeader } from "../../src/lib/governed-submit-header.js";
import { promptScopeWarning } from "../../src/lib/prompt-scope-warning.js";

async function seedScope(root: string, paths: string[]): Promise<void> {
  await mkdir(path.join(root, ".cursor/goal"), { recursive: true });
  await writeFile(
    path.join(root, ".cursor/goal/scope.json"),
    JSON.stringify({ enforce: true, paths }),
    "utf8",
  );
  await writeFile(
    path.join(root, ".cursor/goal/work-units.json"),
    JSON.stringify({ units: [] }),
    "utf8",
  );
}

describe("I273 prompt scope token classification", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("does not classify metrics or prose slash pairs as filesystem paths", () => {
    const prompt =
      "Add a follow-up. Pass: 42/42, 4/42, 38/42. Use trust/WoE ranking, not raw score sort. The field is name/URL. Keep artifacts under .cursor-audit/ui-verify/2026-06-02T16-21-52 and scripts/ui-verify/.";

    const refs = extractPromptPathRefs(prompt);

    expect(refs).not.toContain("42/42");
    expect(refs).not.toContain("4/42");
    expect(refs).not.toContain("38/42");
    expect(refs).not.toContain("trust/WoE");
    expect(refs).not.toContain("name/URL");
    expect(refs).toContain(".cursor-audit/ui-verify/2026-06-02T16-21-52");
    expect(refs).toContain("scripts/ui-verify");
  });

  it("does not hard-block a scoped follow-up prompt because of metric slash tokens", async () => {
    const p = await mkGitProject("i273-followup");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedScope(p.dir, [
      "package.json",
      "scripts/ui-verify/",
      "scripts/e2e-run-resilient.sh",
      "scripts/e2e-route-smoke.sh",
      "scripts/verify-production-ui-smoke.sh",
      "scripts/cursor-goal-record-unit-evidence.mjs",
      "scripts/capture-mvp-ux-review.mjs",
      "scripts/check-mvp-ux-orchestrator-status.mjs",
      "scripts/check-mvp-ux-goal-artifacts.mjs",
      "scripts/seed-e2e-follow.ts",
      "scripts/seed-audit-personas.ts",
      ".cursor-audit/mvp-ux-implementation/",
      ".cursor-audit/ui-verify/",
      "src/components/",
      "src/lib/",
      "src/routes/",
      "tests/",
      "docs/UI_VERIFICATION.md",
      "docs/UI_COVERAGE_MODEL.md",
      "docs/e2e-audit-2026-05-22.md",
      "docs/MVP_UX_COMBINED_PLAN_2026.md",
      "docs/MVP_UX_IMPLEMENTATION_ORCHESTRATOR_PROMPT.md",
    ]);

    const warning = await promptScopeWarning(
      p.dir,
      "Add a follow-up. verify:ui:report still shows Pass: false until waiver. Production proof needs deployment. Asado #3 vs score 9 remains by design (trust/WoE ranking, not raw score sort). Metrics 42/42, 4/42, 38/42. Field name/URL. Artifacts under .cursor-audit/ui-verify/2026-06-02T16-21-52. Run npm run verify:ui:smoke.",
      "agent-273",
    );

    expect(warning).toBeNull();
  });

  it("does not hard-block cursor-goal generated submit context that repeats diagnostic paths", async () => {
    const p = await mkGitProject("i273-generated-context");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(path.join(p.dir, "GOAL.md"), "## Goal\nShip scoped work\n", "utf8");
    await writeFile(
      path.join(p.dir, ".cursor/goal/intent.json"),
      JSON.stringify({ goal: "Close MVP UX implementation inside scoped artifacts" }),
      "utf8",
    );
    await writeFile(
      path.join(p.dir, ".cursor/goal/trajectory.json"),
      JSON.stringify({ phase: "VERIFY" }),
      "utf8",
    );
    await seedScope(p.dir, [
      "package.json",
      "scripts/ui-verify/",
      "docs/MVP_UX_COMBINED_PLAN_2026.md",
      "src/components/",
    ]);
    const header = await formatGovernedSubmitHeader(p.dir);

    const prompt =
      `${header}; ` +
      "SESSION_END present - resume: cursor-goal explain session-end && cursor-goal session-end clear --force && cursor-goal next; " +
      "Prompt intent conflicts with active GOAL: outside active GOAL scope: scripts/cloudflare-observability-audit.mjs, docs/PRODUCTION_DEPLOY.md, 7e47/6c555d5e-b2ac-4b51-94d3-3c1c59637e47.jsonl " +
      "(active scope: [package.json, scripts/ui-verify/, docs/MVP_UX_COMBINED_PLAN_2026.md, src/components/]). " +
      "Correction: cursor-goal next --conversation agent-273 Fallback: keep work inside active scope and target a valid open unit.";

    const warning = await promptScopeWarning(p.dir, prompt, "agent-273");
    expect(warning).toBeNull();
  });

  it("still blocks user-authored generated-looking Goal and Phase text", async () => {
    const p = await mkGitProject("i273-user-authored-generated-looking-text");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedScope(p.dir, ["src/"]);

    const warning = await promptScopeWarning(
      p.dir,
      "Goal: edit docs/README.md\n" +
        "Phase: VERIFY | Units open: 1/1 | Loop: 0/40 | Mode: governed\n" +
        "Also edit src/main.ts",
      "agent-273",
    );

    expect(warning).toContain("outside active GOAL scope: docs/README.md");
    expect(warning).not.toContain("src/main.ts");
  });

  it("still blocks explicit out-of-scope filesystem paths", async () => {
    const p = await mkGitProject("i273-explicit-out-of-scope");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await seedScope(p.dir, ["src/"]);

    const warning = await promptScopeWarning(
      p.dir,
      "Edit docs/README.md and src/main.ts",
      "agent-273",
    );

    expect(warning).toContain("outside active GOAL scope: docs/README.md");
    expect(warning).not.toContain("src/main.ts");
  });
});
