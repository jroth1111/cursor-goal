import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("I126 distribution gitignore hygiene", () => {
  it("ignores generated, cache, virtualenv, editor, and local secret artifacts", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const gitignore = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
    const patterns = new Set(
      gitignore
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")),
    );

    for (const pattern of [
      "dist/",
      "build/",
      "out/",
      "coverage/",
      ".nyc_output/",
      ".cache/",
      ".turbo/",
      ".next/",
      ".vite/",
      ".parcel-cache/",
      "target/",
      ".venv/",
      "venv/",
      "__pycache__/",
      ".pytest_cache/",
      ".mypy_cache/",
      ".ruff_cache/",
      ".idea/",
      ".vscode/",
      ".env",
      ".env.*",
      "!.env.example",
    ]) {
      expect(patterns, `.gitignore missing ${pattern}`).toContain(pattern);
    }
  });
});
