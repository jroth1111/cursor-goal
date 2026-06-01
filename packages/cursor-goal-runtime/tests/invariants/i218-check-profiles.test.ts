import { describe, it, expect, afterEach } from "vitest";
import {
  filterCommandsForProfile,
  resolveStopCheckProfile,
} from "../../src/lib/run-checks.js";
import { parseGoalMd } from "../../src/lib/parse-goal-md.js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { rmSync } from "node:fs";

describe("I218 check profiles", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    delete process.env.CURSOR_GOAL_STOP_CHECK_PROFILE;
  });

  it("parses [fast] and [full] from GOAL.md", async () => {
    const dir = path.join(os.tmpdir(), `i218-parse-${Date.now()}`);
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "GOAL.md"),
      "## Goal\nx\n## Checks\n- `[fast]` true\n- `[full]` false\n- npm test\n",
      "utf8",
    );
    const parsed = await parseGoalMd(dir);
    expect(parsed.checkTiers["true"]).toBe("fast");
    expect(parsed.checkTiers["false"]).toBe("full");
    expect(parsed.checkTiers["npm test"]).toBe("full");
  });

  it("filterCommandsForProfile respects tiers", () => {
    const cmds = ["true", "false", "npm test"];
    const tiers = { true: "fast" as const, false: "full" as const, "npm test": "full" as const };
    expect(filterCommandsForProfile(cmds, tiers, "fast")).toEqual(["true"]);
    expect(filterCommandsForProfile(cmds, tiers, "all")).toEqual(cmds);
  });

  it("resolveStopCheckProfile honors env and loop count", () => {
    process.env.CURSOR_GOAL_STOP_CHECK_PROFILE = "fast";
    expect(resolveStopCheckProfile(0)).toBe("fast");
    delete process.env.CURSOR_GOAL_STOP_CHECK_PROFILE;
    expect(resolveStopCheckProfile(0)).toBe("all");
    expect(resolveStopCheckProfile(2)).toBe("fast");
  });
});
