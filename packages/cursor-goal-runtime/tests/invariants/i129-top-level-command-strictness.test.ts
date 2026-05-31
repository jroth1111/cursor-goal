import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

describe("I129 top-level command strictness", () => {
  it("rejects unknown top-level commands without breaking help usage", () => {
    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");

    const unknown = spawnSync("node", [cli, "statuz"], {
      encoding: "utf8",
    });
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toMatch(/Unknown command: statuz/);
    expect(unknown.stdout).toMatch(/Usage:/);

    const help = spawnSync("node", [cli, "--help"], {
      encoding: "utf8",
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/Usage:/);

    const noCommand = spawnSync("node", [cli], {
      encoding: "utf8",
    });
    expect(noCommand.status).toBe(0);
    expect(noCommand.stdout).toMatch(/Usage:/);
  });
});
