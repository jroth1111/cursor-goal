import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Invariant = {
  id: string;
  layers?: string[];
};

function hasLayerClaim(value: string): boolean {
  const normalized = value.trim();
  return normalized !== "" && normalized !== "—" && normalized !== "-";
}

describe("I127 capability layer claims match INVARIANTS", () => {
  it("keeps Core, Runtime, and Supervisor columns aligned with registered layers", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../");
    const capability = await readFile(path.join(repoRoot, "CAPABILITY.md"), "utf8");
    const invariants = JSON.parse(await readFile(path.join(repoRoot, "INVARIANTS.json"), "utf8")) as {
      invariants?: Invariant[];
    };
    const byId = new Map((invariants.invariants ?? []).map((inv) => [inv.id, inv]));

    const rows = capability
      .split(/\r?\n/)
      .filter((line) => /^\| I\d+ /.test(line))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

    for (const [id, , core, runtime, supervisor, , status] of rows) {
      if (status !== "tested") continue;
      const layers = byId.get(id)?.layers ?? [];
      expect(hasLayerClaim(core), `${id} Core column should match INVARIANTS`).toBe(
        layers.includes("core"),
      );
      expect(hasLayerClaim(runtime), `${id} Runtime column should match INVARIANTS`).toBe(
        layers.includes("runtime"),
      );
      expect(hasLayerClaim(supervisor), `${id} Supervisor column should match INVARIANTS`).toBe(
        layers.includes("supervisor"),
      );
    }
  });
});
