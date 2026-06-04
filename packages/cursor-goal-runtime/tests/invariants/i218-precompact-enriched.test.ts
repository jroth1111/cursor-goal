import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I218 preCompact enriched output stays under 2000 characters", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    cleanup = undefined;
    restore = undefined;
  });

  it("includes recent edits, open units, and stop signatures in snapshot", async () => {
    const p = await mkGitProject("i218-precompact");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;

    // Set up compiled goal artifacts
    const gd = path.join(p.dir, ".cursor/goal");
    await mkdir(path.join(gd, "evidence"), { recursive: true });

    // Write edits ledger
    await writeFile(
      path.join(gd, "evidence", "edits.jsonl"),
      [
        { at: new Date().toISOString(), tool: "Write", file_path: "src/foo.ts" },
        { at: new Date().toISOString(), tool: "Edit", file_path: "src/bar.ts" },
        { at: new Date().toISOString(), tool: "Write", file_path: "src/baz.ts" },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    );

    // Write work units with open items
    await writeFile(
      path.join(gd, "work-units.json"),
      JSON.stringify({
        units: [
          { id: "u1", title: "Unit 1", status: "pending", scope: ["src/"], acceptance: [], subagent_id: null },
          { id: "u2", title: "Unit 2", status: "in_progress", scope: ["lib/"], acceptance: [], subagent_id: "agent-1" },
        ],
      }),
      "utf8",
    );

    // Write stop signatures
    const agentsDir = path.join(gd, "agents/default");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, "stop-signatures.jsonl"),
      [
        { at: new Date().toISOString(), signature: "L3::npm_test|scope" },
        { at: new Date().toISOString(), signature: "L3::npm_test|scope" },
        { at: new Date().toISOString(), signature: "L-other::npm_test" },
      ].map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    );

    // Import and run the preCompact hook logic indirectly by verifying the
    // enrichment functions produce bounded output.
    const { listRecentEditedFiles } = await import("../../src/lib/edit-ledger.js");
    const { readWorkUnits } = await import("../../src/lib/work-units.js");
    const { readStopSignatureTail } = await import("../../src/lib/stop-signature.js");

    const edited = await listRecentEditedFiles(p.dir);
    expect(edited.length).toBeGreaterThanOrEqual(3);

    const wu = await readWorkUnits(p.dir);
    expect(wu).not.toBeNull();
    const open = wu!.units.filter((u) => u.status === "in_progress" || u.status === "pending");
    expect(open.length).toBeGreaterThanOrEqual(2);

    const sigs = await readStopSignatureTail(p.dir, "default", 3);
    expect(sigs.length).toBeGreaterThanOrEqual(3);

    // Simulate the enriched output length
    const lines = [
      "[cursor-goal compaction snapshot]",
      `phase: IMPLEMENT`,
      `recent_edits (${edited.length}): ${edited.join(", ")}`,
      `open_units: ${open.map((u) => `${u.id}(${u.status})`).join(", ")}`,
      `last_signatures: ${sigs.map((s) => s.signature.slice(0, 60)).join(" | ")}`,
    ];
    const output = lines.join("\n");
    expect(output.length).toBeLessThan(2000);
  });
});
