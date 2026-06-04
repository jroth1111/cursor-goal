import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("I269 afterAgentResponse is linked and installed with user hooks", () => {
  it("build linker emits hook-afterAgentResponse.mjs", async () => {
    const script = await readFile(
      path.resolve(import.meta.dirname, "../../scripts/link-hooks.mjs"),
      "utf8",
    );
    expect(script).toMatch(/"afterAgentResponse"/);
    expect(
      existsSync(path.resolve(import.meta.dirname, "../../dist/hook-afterAgentResponse.mjs")),
    ).toBe(true);
  });

  it("global user hook template registers afterAgentResponse", async () => {
    const template = JSON.parse(
      await readFile(
        path.resolve(import.meta.dirname, "../../../../core/.cursor/hooks.json.user.example"),
        "utf8",
      ),
    ) as { hooks?: Record<string, { command?: string }[]> };

    const entries = template.hooks?.afterAgentResponse ?? [];
    expect(entries.map((entry) => entry.command)).toContain("hooks/goal-after-response.sh");
  });
});
