import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildUnitTaskPrompt } from "../../src/lib/unit-task-prompt.js";
import { buildUnitTaskPrompt as supervisorBuild } from "../../../../supervisor/unit-prompt.mjs";

describe("I81 unit task prompt parity", () => {
  it("supervisor prompt matches runtime for same unit", () => {
    const unit = {
      id: "auth-middleware",
      title: "Auth middleware",
      scope: ["src/auth/"],
      acceptance: ["npm test -- src/auth"],
    };
    expect(supervisorBuild(unit)).toBe(buildUnitTaskPrompt(unit as never));
  });

  it("includes deliverable.md path when verified_by is set", () => {
    const unit = {
      id: "auth-middleware",
      title: "Auth middleware",
      scope: ["src/auth/"],
      acceptance: ["npm test -- src/auth"],
      verified_by: "verifier",
    };
    const prompt = buildUnitTaskPrompt(unit as never);
    expect(prompt).toMatch(/outputs\/auth-middleware\/deliverable\.md/);
    expect(supervisorBuild(unit)).toBe(prompt);
  });

  it("loads global prompt builder from CURSOR_HOME when no repo runtime is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "cgr-i81-cursor-home-"));
    try {
      const installRoot = path.join(tmp, "install");
      const projectRoot = path.join(tmp, "project");
      const fakeHome = path.join(tmp, "home");
      const cursorHome = path.join(tmp, "cursor-home");
      const runtimeLib = path.join(cursorHome, "cursor-goal-runtime/dist/lib");
      await mkdir(path.join(installRoot, "supervisor"), { recursive: true });
      await mkdir(projectRoot, { recursive: true });
      await mkdir(runtimeLib, { recursive: true });
      await copyFile(
        path.resolve(import.meta.dirname, "../../../../supervisor/unit-prompt.mjs"),
        path.join(installRoot, "supervisor/unit-prompt.mjs"),
      );
      await writeFile(
        path.join(cursorHome, "cursor-goal-runtime/package.json"),
        '{"type":"module"}\n',
        "utf8",
      );
      await writeFile(
        path.join(runtimeLib, "unit-task-prompt.js"),
        `export function buildUnitTaskPrompt(unit) {
  return "global-cursor-home:" + unit.id;
}
`,
        "utf8",
      );
      const script = path.join(tmp, "check.mjs");
      await writeFile(
        script,
        `import { buildUnitTaskPrompt } from ${JSON.stringify(
          path.join(installRoot, "supervisor/unit-prompt.mjs"),
        )};
process.stdout.write(buildUnitTaskPrompt({
  id: "unit-a",
  title: "Unit A",
  scope: [],
  acceptance: [],
}));
`,
        "utf8",
      );

      const r = spawnSync("node", [script], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: fakeHome,
          CURSOR_HOME: cursorHome,
          CURSOR_GOAL_RUNTIME: "",
        },
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe("global-cursor-home:unit-a");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
