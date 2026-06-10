import { afterEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { detectTamper, outOfScopeEdits, checkIntegrity } from "../src/driver/integrity.js";
import { mkGitProject } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function commit(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(root, rel);
    mkdirSync(path.dirname(fp), { recursive: true });
    writeFileSync(fp, content);
  }
  execSync("git add -A && git commit -q -m fixture", { cwd: root, stdio: "ignore" });
}

describe("reward-hack detection", () => {
  it("flags a deleted test file", () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    commit(p.root, { "src/__tests__/foo.test.ts": "test('x', () => expect(1).toBe(1));\n" });
    rmSync(path.join(p.root, "src/__tests__/foo.test.ts"));
    const issues = detectTamper(p.root);
    expect(issues.some((i) => /deleted a test file/.test(i))).toBe(true);
  });

  it("flags a '|| true' appended to a check", () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    commit(p.root, { "run-tests.sh": "#!/bin/sh\nnpm test\n" });
    writeFileSync(path.join(p.root, "run-tests.sh"), "#!/bin/sh\nnpm test || true\n");
    const issues = detectTamper(p.root);
    expect(issues.some((i) => /\|\| true/.test(i))).toBe(true);
  });

  it("flags a skipped test", () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    commit(p.root, { "spec/calc.spec.js": "it('adds', () => {});\n" });
    writeFileSync(path.join(p.root, "spec/calc.spec.js"), "it.skip('adds', () => {});\n");
    const issues = detectTamper(p.root);
    expect(issues.some((i) => /skipped a test/.test(i))).toBe(true);
  });

  it("does not flag a legitimate non-test change", () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    commit(p.root, { "src/app.ts": "export const x = 1;\n" });
    writeFileSync(path.join(p.root, "src/app.ts"), "export const x = 2;\n");
    expect(detectTamper(p.root)).toEqual([]);
  });
});

describe("scope enforcement", () => {
  it("flags edits outside the declared scope", () => {
    expect(outOfScopeEdits(["src/a.ts", "other/b.ts"], ["src/"])).toEqual(["other/b.ts"]);
  });
  it("allows everything when scope is empty", () => {
    expect(outOfScopeEdits(["anywhere/x.ts"], [])).toEqual([]);
  });
  it("treats GOAL.md and driver state as always in-scope", () => {
    expect(outOfScopeEdits(["GOAL.md", ".cursor/goal/driver/run.json"], ["src/"])).toEqual([]);
  });
  it("matches a scoped file exactly and by directory prefix", () => {
    expect(outOfScopeEdits(["pkg/x.ts", "pkg"], ["pkg"])).toEqual([]);
    expect(outOfScopeEdits(["pkgother/x.ts"], ["pkg"])).toEqual(["pkgother/x.ts"]);
  });
});

describe("checkIntegrity composition", () => {
  it("combines tamper and scope issues", () => {
    const p = mkGitProject();
    cleanups.push(p.cleanup);
    commit(p.root, { "src/x.ts": "1\n", "tests/y.test.ts": "it('a',()=>{})\n" });
    writeFileSync(path.join(p.root, "tests/y.test.ts"), "xit('a',()=>{})\n");
    const issues = checkIntegrity(p.root, ["src/x.ts", "outside/z.ts"], ["src/"]);
    expect(issues.some((i) => /skipped a test/.test(i))).toBe(true);
    expect(issues.some((i) => /out-of-scope file: outside\/z\.ts/.test(i))).toBe(true);
  });
});
