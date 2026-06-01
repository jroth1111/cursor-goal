import { describe, it, expect } from "vitest";
import { shellCommandAllowed, shellPolicyDenyFixtures } from "../../src/lib/shell-allow.js";
import { execCoreHook } from "../hooks/exec-hook.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

describe("I202 shell policy parity", () => {
  it("TS policy and minimal beforeShellExecution deny the same fixtures", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "i202-"));
    try {
      mkdirSync(path.join(dir, ".git"), { recursive: true });
      writeFileSync(path.join(dir, "GOAL.md"), "## Goal\nx\n## Checks\n- `true`\n");
      for (const command of shellPolicyDenyFixtures()) {
        expect(shellCommandAllowed(command), command).toBe(false);
        expect(
          execCoreHook(dir, "beforeShellExecution", { command }).stdout.permission,
          command,
        ).toBe("deny");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps destructive denials when the installed runtime cannot read the source policy file", () => {
    const moduleUrl = pathToFileURL(
      path.resolve(import.meta.dirname, "../../dist/lib/shell-allow.js"),
    ).href;
    const r = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `
          process.env.CURSOR_GOAL_SHELL_POLICY_PATH = "/definitely/missing/destructive-shell.json";
          const m = await import(${JSON.stringify(moduleUrl)});
          if (m.shellCommandAllowed("rm -rf /tmp/x")) process.exit(1);
          if (!m.shellPolicyDenyFixtures().includes("rm -rf /tmp/x")) process.exit(2);
        `,
      ],
      { encoding: "utf8" },
    );

    expect(r.status, r.stderr || r.stdout).toBe(0);
  });
});
