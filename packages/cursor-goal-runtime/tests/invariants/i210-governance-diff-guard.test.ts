import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I210 governance diff guard", () => {
  let repoDir: string;

  afterEach(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  });

  it("warns when CAPABILITY.md changes without CURSOR_GOAL_GOVERNANCE_OK", async () => {
    repoDir = path.join(os.tmpdir(), `i210-${Date.now()}`);
    await mkdir(repoDir, { recursive: true });
    const script = path.resolve(import.meta.dirname, "../../../../scripts/verify-governance-diff.mjs");

    const init = spawnSync("git", ["init"], { cwd: repoDir, encoding: "utf8" });
    expect(init.status).toBe(0);
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    spawnSync("git", ["config", "user.name", "test"], { cwd: repoDir });
    await writeFile(path.join(repoDir, "CAPABILITY.md"), "| stub |\n", "utf8");
    spawnSync("git", ["add", "CAPABILITY.md"], { cwd: repoDir });
    spawnSync("git", ["commit", "-m", "init"], { cwd: repoDir });
    await writeFile(path.join(repoDir, "CAPABILITY.md"), "| stub | updated |\n", "utf8");

    const r = spawnSync("node", [script], {
      cwd: repoDir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_GOAL_GOVERNANCE_OK: "" },
    });

    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/Governance files changed/);
  });

  it("exits 1 in strict mode without acknowledgment", async () => {
    repoDir = path.join(os.tmpdir(), `i210-strict-${Date.now()}`);
    await mkdir(repoDir, { recursive: true });
    const script = path.resolve(import.meta.dirname, "../../../../scripts/verify-governance-diff.mjs");

    spawnSync("git", ["init"], { cwd: repoDir });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    spawnSync("git", ["config", "user.name", "test"], { cwd: repoDir });
    await writeFile(path.join(repoDir, "INVARIANTS.json"), '{"invariants":[]}\n', "utf8");
    spawnSync("git", ["add", "INVARIANTS.json"], { cwd: repoDir });
    spawnSync("git", ["commit", "-m", "init"], { cwd: repoDir });
    await writeFile(path.join(repoDir, "INVARIANTS.json"), '{"invariants":[{"id":"I1"}]}\n', "utf8");

    const r = spawnSync("node", [script], {
      cwd: repoDir,
      encoding: "utf8",
      env: { ...process.env, CURSOR_GOAL_STRICT: "1", CURSOR_GOAL_GOVERNANCE_OK: "" },
    });

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Governance files changed/);
  });
});
