import { describe, expect, it } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseGoalMd } from "../src/lib/parse-goal-md.js";

describe("parseGoalMd", () => {
  it("extracts checks", async () => {
    const dir = await mkdtemp();
const md = `## Checks
- \`npm test\`
- \`npm run lint\`
`;
    await writeFile(path.join(dir, "GOAL.md"), md, "utf8");
    process.env.CURSOR_PROJECT_DIR = dir;
    const p = await parseGoalMd(dir);
    expect(p.checks).toEqual(["npm test", "npm run lint"]);
    await rm(dir, { recursive: true, force: true });
  });
});

async function mkdtemp(): Promise<string> {
  const dir = path.join(os.tmpdir(), `cgr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
