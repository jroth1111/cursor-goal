import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("I131 conversation option usage", () => {
  it("documents supported conversation-scoped commands and rejects ignored status conversation args", () => {
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const help = spawnSync("node", [cli, "--help"], {
      encoding: "utf8",
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("cursor-goal next [--json|--verbose] [--conversation <id>]");
    expect(help.stdout).toContain("cursor-goal explain [--json] [--conversation <id>]");
    expect(help.stdout).toContain("cursor-goal status --json [--conversation <id>]");
    expect(help.stdout).toContain("cursor-goal mode why [--conversation <id>]");

    const ignored = spawnSync("node", [cli, "status", "--conversation", "conv-1"], {
      encoding: "utf8",
    });
    expect(ignored.status).not.toBe(0);
    expect(ignored.stderr).toMatch(/Unknown option: --conversation/);
  });
});
