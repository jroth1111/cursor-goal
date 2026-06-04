import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("I260 runtime build publishes dist without deleting live entrypoints first", () => {
  it("stages build output before publishing into dist", async () => {
    const runtimeRoot = path.resolve(import.meta.dirname, "../..");
    const pkg = JSON.parse(await readFile(path.join(runtimeRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const build = pkg.scripts?.build ?? "";

    expect(build).not.toMatch(/rm\s+-rf\s+dist\s*&&/);
    expect(build).toContain(".dist-build");
    expect(build).toContain("publish-dist.mjs");
  });
});
