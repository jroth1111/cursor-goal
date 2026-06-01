import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("I185 installed parity check script", () => {
  it("is part of root npm run check", async () => {
    const root = path.resolve(import.meta.dirname, "../../../../");
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.check).toContain("verify-installed-parity.mjs");
  });

  it("verifies a temporary installed snapshot without mutating the real global install", () => {
    const root = path.resolve(import.meta.dirname, "../../../../");
    const script = path.join(root, "scripts/verify-installed-parity.mjs");
    const r = spawnSync("node", [script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CURSOR_GOAL_PARITY_TEMP: "1" },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/Installed parity OK/);
  });
});
