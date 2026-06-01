import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import {
  readLoopLimitFromGlobalHooksJson,
  readLoopLimitFromHooksJson,
} from "../../src/lib/git-state.js";
import { readLoopLimit } from "../../src/lib/loop-limit.js";

describe("I196 loop_limit from global hooks", () => {
  let tmp = "";
  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    delete process.env.CURSOR_HOME;
  });

  it("uses project loop_limit over global", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "i196-"));
    const cursorHome = path.join(tmp, "cursor");
    const project = path.join(tmp, "proj");
    await mkdir(path.join(cursorHome, "hooks"), { recursive: true });
    await mkdir(path.join(project, ".cursor"), { recursive: true });
    await writeFile(
      path.join(cursorHome, "hooks.json"),
      JSON.stringify({ version: 1, hooks: { stop: [{ loop_limit: 99 }] } }),
      "utf8",
    );
    await writeFile(
      path.join(project, ".cursor/hooks.json"),
      JSON.stringify({ version: 1, hooks: { stop: [{ loop_limit: 12 }] } }),
      "utf8",
    );
    process.env.CURSOR_HOME = cursorHome;
    expect(readLoopLimitFromHooksJson(project)).toBe(12);
  });

  it("falls back to global when project hooks missing", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "i196g-"));
    const cursorHome = path.join(tmp, "cursor");
    const project = path.join(tmp, "proj");
    await mkdir(path.join(cursorHome, "hooks"), { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(cursorHome, "hooks.json"),
      JSON.stringify({ version: 1, hooks: { stop: [{ loop_limit: 55 }] } }),
      "utf8",
    );
    process.env.CURSOR_HOME = cursorHome;
    expect(readLoopLimitFromGlobalHooksJson()).toBe(55);
    expect(await readLoopLimit(project)).toBe(55);
  });

  it("manifest overrides global when project hooks omit loop_limit", async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "i196m-"));
    const cursorHome = path.join(tmp, "cursor");
    const project = path.join(tmp, "proj");
    await mkdir(path.join(cursorHome, "hooks"), { recursive: true });
    await mkdir(path.join(project, ".cursor/goal"), { recursive: true });
    await writeFile(
      path.join(cursorHome, "hooks.json"),
      JSON.stringify({ version: 1, hooks: { stop: [{ loop_limit: 99 }] } }),
      "utf8",
    );
    await writeFile(
      path.join(project, ".cursor/goal/manifest.json"),
      JSON.stringify({ loop_limit: 7 }),
      "utf8",
    );
    process.env.CURSOR_HOME = cursorHome;
    expect(await readLoopLimit(project)).toBe(7);
  });
});
