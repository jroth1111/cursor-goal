import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Invariant = {
  id: string;
  layers?: string[];
};

describe("I125 capability matrix uses current layer columns", () => {
  it("uses Supervisor instead of legacy Pi and marks supervisor rows from INVARIANTS", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const capability = await readFile(path.join(repoRoot, "CAPABILITY.md"), "utf8");
    const invariants = JSON.parse(await readFile(path.join(repoRoot, "INVARIANTS.json"), "utf8")) as {
      invariants?: Invariant[];
    };
    const byId = new Map((invariants.invariants ?? []).map((inv) => [inv.id, inv]));

    const header = capability.split("\n").find((line) => line.startsWith("| Invariant |"));
    expect(header).toContain("| Core | Runtime | Supervisor |");
    expect(header).not.toContain("| Pi |");

    const rows = capability
      .split("\n")
      .filter((line) => /^\| I\d+ /.test(line))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

    for (const [id, , , , supervisor, , status] of rows) {
      if (status !== "tested") continue;
      const inv = byId.get(id);
      expect(inv, `${id} must be registered in INVARIANTS.json`).toBeTruthy();
      const hasSupervisor = inv?.layers?.includes("supervisor") ?? false;
      expect(
        supervisor !== "—",
        `${id} Supervisor column should match INVARIANTS.json layers`,
      ).toBe(hasSupervisor);
    }
  });
});
