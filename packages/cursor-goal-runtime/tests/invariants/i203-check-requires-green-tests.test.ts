import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("I203 root check runs tests before capability verify", () => {
  it("orders npm test before verify-capability.mjs in package.json check script", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const pkg = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: { check?: string } };
    const check = pkg.scripts?.check ?? "";
    const testIdx = check.indexOf("npm test");
    const capIdx = check.indexOf("verify-capability.mjs");
    expect(testIdx, "check must run npm test").toBeGreaterThanOrEqual(0);
    expect(capIdx, "check must run verify-capability.mjs").toBeGreaterThanOrEqual(0);
    expect(testIdx, "npm test must run before verify-capability.mjs").toBeLessThan(capIdx);
  });
});
