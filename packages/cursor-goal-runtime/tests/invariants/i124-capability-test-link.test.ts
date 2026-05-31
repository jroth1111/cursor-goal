import { describe, expect, it, afterEach } from "vitest";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I124 capability verifier cross-checks tested rows against invariants", () => {
  let fakeRoot = "";

  afterEach(() => {
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it("fails on stale capability rows and mismatched test stems even when files exist", async () => {
    fakeRoot = path.join(os.tmpdir(), `i124-capability-${Date.now()}`);
    const scriptsDir = path.join(fakeRoot, "scripts");
    const testDir = path.join(fakeRoot, "packages/cursor-goal-runtime/tests/invariants");
    await mkdir(scriptsDir, { recursive: true });
    await mkdir(testDir, { recursive: true });

    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    await copyFile(
      path.join(repoRoot, "scripts/verify-capability.mjs"),
      path.join(scriptsDir, "verify-capability.mjs"),
    );
    await writeFile(
      path.join(fakeRoot, "INVARIANTS.json"),
      `${JSON.stringify(
        {
          version: 1,
          invariants: [
            {
              id: "I999",
              description: "Example invariant must point to its registered test",
              layers: ["runtime"],
              release_blocking: true,
              test: "packages/cursor-goal-runtime/tests/invariants/i999-expected.test.ts",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(path.join(testDir, "i999-expected.test.ts"), "export {};\n", "utf8");
    await writeFile(path.join(testDir, "i998-wrong.test.ts"), "export {};\n", "utf8");
    await writeFile(
      path.join(fakeRoot, "CAPABILITY.md"),
      [
        "| Invariant | Capability | Core | Runtime | Supervisor | Test | Status |",
        "|-----------|------------|------|---------|------------|------|--------|",
        "| I999 | wrong link | — | yes | — | i998-wrong | tested |",
        "| I998 | stale row | — | yes | — | i998-wrong | tested |",
        "",
      ].join("\n"),
      "utf8",
    );

    const r = spawnSync("node", [path.join(scriptsDir, "verify-capability.mjs")], {
      cwd: fakeRoot,
      encoding: "utf8",
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(
      /I999: CAPABILITY tested row references "i998-wrong" but INVARIANTS\.json declares "i999-expected"/,
    );
    expect(r.stderr).toMatch(/I998: CAPABILITY tested row is not registered in INVARIANTS\.json/);
  });
});
