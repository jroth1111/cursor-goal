import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGoalMd } from "../src/lib/parse-goal-md.js";
import { runStopVerifier } from "../src/lib/verify.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("adversarial fixtures", () => {
  it("empty checks fixture parses zero commands", async () => {
    const text = await readFile(path.join(fixtures, "adversarial-empty-checks.md"), "utf8");
    const checks = text.match(/## Checks[\s\S]*?(?=\n## |$)/i)?.[0] ?? "";
    expect(checks).not.toMatch(/^- /m);
  });

  it("test-only + forbidden proxy triggers continue on verify", async () => {
    const dir = path.join(os.tmpdir(), `cgr-adv-${Date.now()}`);
    await mkdir(path.join(dir, ".cursor", "goal", "passports"), { recursive: true });
    const md = await readFile(path.join(fixtures, "adversarial-test-only.md"), "utf8");
    await writeFile(path.join(dir, "GOAL.md"), md, "utf8");
    const prev = process.env.CURSOR_PROJECT_DIR;
    process.env.CURSOR_PROJECT_DIR = dir;

    const parsed = await parseGoalMd(dir);
    expect(parsed.checks).toEqual(["npm test"]);
    expect(parsed.forbiddenProxies.length).toBeGreaterThan(0);

    const r = await runStopVerifier({ status: "completed", loop_count: 0 });
    expect(r.kind).not.toBe("release");

    process.env.CURSOR_PROJECT_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  });
});
