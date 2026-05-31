import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("I123 root check runs repository claim verifiers", () => {
  it("wires README and capability claim checks into npm run check", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    const check = pkg.scripts?.check ?? "";
    expect(check).toContain("npm run check -w @cursor-goal/runtime");
    expect(check).toContain("node scripts/verify-readme-claims.mjs");
    expect(check).toContain("node scripts/verify-capability.mjs");
  });
});
