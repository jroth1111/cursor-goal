import { describe, expect, it, afterEach } from "vitest";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I122 capability verifier requires registered invariants in CAPABILITY", () => {
  let fakeRoot = "";

  afterEach(() => {
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  it("fails when INVARIANTS.json has a tested invariant missing from CAPABILITY.md", async () => {
    fakeRoot = path.join(os.tmpdir(), `i122-capability-${Date.now()}`);
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
              description: "Example invariant must be surfaced in capability docs",
              layers: ["runtime"],
              release_blocking: true,
              test: "packages/cursor-goal-runtime/tests/invariants/i999-example.test.ts",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(path.join(testDir, "i999-example.test.ts"), "export {};\n", "utf8");
    await writeFile(
      path.join(fakeRoot, "CAPABILITY.md"),
      "| Invariant | Capability | Core | Runtime | Supervisor | Test | Status |\n" +
        "|-----------|------------|------|---------|------------|------|--------|\n",
      "utf8",
    );

    const r = spawnSync("node", [path.join(scriptsDir, "verify-capability.mjs")], {
      cwd: fakeRoot,
      encoding: "utf8",
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/I999: registered in INVARIANTS\.json but missing from CAPABILITY\.md/);
  });
});
