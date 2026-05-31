import { describe, it, expect, afterEach } from "vitest";
import { parseVerifierResponse, VERDICT_REPROMPT_TEXT } from "../../src/lib/verdict-parse.js";
import { recordVerifierResponse } from "../../src/lib/dispatch-verify.js";
import { mkGitProject } from "../helpers/git-fixture.js";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { compileGoalV2 } from "../../src/compile/compile-v2.js";

describe("I83 verdict parse", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("parses PASS and FAIL lines", () => {
    expect(parseVerifierResponse("analysis\nVERDICT: PASS").passed).toBe(true);
    expect(parseVerifierResponse("VERDICT: FAIL").passed).toBe(false);
  });

  it("marks missing verdict inconclusive", () => {
    const r = parseVerifierResponse("no verdict here");
    expect(r.inconclusive).toBe(true);
  });

  it("does not treat incidental verdict mentions as final verdict lines", () => {
    const passMention = parseVerifierResponse("I cannot conclude VERDICT: PASS from this evidence.");
    expect(passMention.inconclusive).toBe(true);
    expect(passMention.passed).toBe(false);

    const failMention = parseVerifierResponse("The prompt says to write VERDICT: FAIL when evidence is bad.");
    expect(failMention.inconclusive).toBe(true);
    expect(failMention.passed).toBe(false);
  });

  it("recordVerifierResponse sets reprompt_used when allowReprompt and inconclusive", async () => {
    const p = await mkGitProject("i83-reprompt");
    cleanup = p.cleanup;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal\nx\n## Work units\n\n### u1\nUnit\n- scope: \`src/\`\n- verified_by: v\n## Checks\n- \`true\`\n`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const r = await recordVerifierResponse(p.dir, "u1", "analysis only", { allowReprompt: true });
    expect(r.reprompt_used).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("passes when VERDICT appears after reprompt block in transcript", async () => {
    const p = await mkGitProject("i83-reprompt-pass");
    cleanup = p.cleanup;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      `## Goal\nx\n## Work units\n\n### u1\nUnit\n- scope: \`src/\`\n- verified_by: v\n## Checks\n- \`true\`\n`,
      "utf8",
    );
    await compileGoalV2(p.dir);
    const text = `review\n\n${VERDICT_REPROMPT_TEXT}\nVERDICT: PASS`;
    const r = await recordVerifierResponse(p.dir, "u1", text, { allowReprompt: true });
    expect(r.passed).toBe(true);
  });
});
