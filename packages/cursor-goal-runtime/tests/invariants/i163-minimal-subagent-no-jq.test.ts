import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkGitProject, withProjectEnv } from "../helpers/git-fixture.js";

describe("I163 minimal subagent isolation without jq", () => {
  let cleanup: (() => Promise<void>) | undefined;
  let restore: (() => void) | undefined;
  let home = "";
  let bin = "";

  afterEach(async () => {
    restore?.();
    await cleanup?.();
    if (home) rmSync(home, { recursive: true, force: true });
    if (bin) rmSync(bin, { recursive: true, force: true });
    cleanup = undefined;
    restore = undefined;
    home = "";
    bin = "";
  });

  it("denies subagent governance writes when runtime and jq are unavailable", async () => {
    const p = await mkGitProject("i163-minimal-subagent-no-jq");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    home = mkdtempSync(path.join(os.tmpdir(), "i163-home-"));
    bin = mkdtempSync(path.join(os.tmpdir(), "i163-bin-"));
    await writeFile(path.join(bin, "jq"), "#!/bin/sh\nexit 127\n", { mode: 0o755 });

    const script = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/hooks/goal-pre-tool.sh",
    );
    const r = spawnSync("bash", [script], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: ".cursor/goal/manifest.json",
        is_subagent: true,
        work_unit_id: "unit-a",
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_PROJECT_DIR: p.dir,
        HOME: home,
        PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as {
      permission?: string;
      agent_message?: string;
    };
    expect(out.permission).toBe("deny");
    expect(String(out.agent_message ?? "")).toMatch(/Subagents|governance/i);
  });

  it("denies outside-root evidence writes when runtime and jq are unavailable", async () => {
    const p = await mkGitProject("i163-minimal-outside-evidence-no-jq");
    cleanup = p.cleanup;
    restore = withProjectEnv(p.dir).restore;
    home = mkdtempSync(path.join(os.tmpdir(), "i163-home-"));
    bin = mkdtempSync(path.join(os.tmpdir(), "i163-bin-"));
    await writeFile(path.join(bin, "jq"), "#!/bin/sh\nexit 127\n", { mode: 0o755 });

    const script = path.resolve(
      import.meta.dirname,
      "../../../../core/.cursor/hooks/goal-pre-tool.sh",
    );
    const r = spawnSync("bash", [script], {
      cwd: p.dir,
      input: JSON.stringify({
        tool_name: "Write",
        file_path: path.join(path.dirname(p.dir), ".cursor/goal/evidence/units/unit-a.jsonl"),
        is_subagent: true,
        work_unit_id: "unit-a",
      }),
      encoding: "utf8",
      env: {
        ...process.env,
        CURSOR_PROJECT_DIR: p.dir,
        HOME: home,
        PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      },
    });

    expect(r.status, r.stderr || r.stdout).toBe(0);
    const out = JSON.parse((r.stdout ?? "{}").trim() || "{}") as {
      permission?: string;
      agent_message?: string;
    };
    expect(out.permission).toBe("deny");
    expect(String(out.agent_message ?? "")).toMatch(/outside project root/i);
  });
});
