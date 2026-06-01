import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("I197 shell gated only on beforeShellExecution", () => {
  it("hooks example assigns matcher on preToolUse and shell on beforeShellExecution", () => {
    const example = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/hooks.json.user.example",
    );
    const cfg = JSON.parse(readFileSync(example, "utf8")) as {
      hooks: {
        preToolUse?: Array<{ matcher?: string }>;
        beforeShellExecution?: Array<{ command?: string }>;
      };
    };
    expect(cfg.hooks.beforeShellExecution?.[0]?.command).toContain("goal-shell");
    expect(cfg.hooks.preToolUse?.[0]?.matcher).toBeDefined();
    expect(cfg.hooks.preToolUse?.[0]?.matcher).not.toMatch(/Shell/);
  });
});
