import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";
import { runStopVerifier } from "../../src/lib/verify.js";
import { governanceFollowupMessage } from "../../src/verifier/pipeline.js";

describe("I209 stop followup governance tag", () => {
  let cleanup: () => Promise<void>;
  let restore: () => void;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
  });

  it("prefixes governance followup helper once", () => {
    expect(governanceFollowupMessage("Checks still failing.")).toBe(
      "[governance] Checks still failing.",
    );
    expect(governanceFollowupMessage("[governance] already tagged")).toBe(
      "[governance] already tagged",
    );
  });

  it("tags continue stop messages when checks fail", async () => {
    const p = await mkGitProject("i209");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    await writeFile(
      path.join(p.dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `false`\n",
      "utf8",
    );

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).toBe("continue");
    if (r.kind === "continue") {
      expect(r.message).toMatch(/^\[governance\]/);
    }
  });
});
