import { describe, expect, it } from "vitest";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const runtimeRoot = path.resolve(import.meta.dirname, "../..");
const cursorGoalRoot = path.resolve(runtimeRoot, "../..");
const forbiddenIntent = `pi-${"intent"}`;
const forbiddenScope = `@${"pioff"}`;
const forbiddenEnv = `CURSOR_GOAL_PI_${"INTENT"}`;
const forbiddenPeerScript = `with-pi-${"intent"}`;
const forbiddenNestedRuntime = `cursor-goal/${"packages"}/cursor-goal-runtime`;

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      files.push(...(await collectFiles(full)));
    } else if (/\.(ts|mjs|js|json|sh|md|yml|yaml)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("I77 standalone cursor-goal package boundary", () => {
  it("has its own package root and runtime workspace", async () => {
    const pkg = await readJson(path.join(cursorGoalRoot, "package.json"));
    expect(pkg.name).toBe("cursor-goal");
    expect(pkg.private).toBe(true);
    expect(pkg.workspaces).toEqual(["packages/cursor-goal-runtime"]);

    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.build).toContain("@cursor-goal/runtime");
    expect(scripts.test).toContain("@cursor-goal/runtime");
    expect(scripts.check).toContain("@cursor-goal/runtime");
    expect(scripts).not.toHaveProperty(`test:${forbiddenPeerScript}`);
    expect(JSON.stringify(scripts)).not.toContain("pioff");
  });

  it("uses cursor-goal package scope with no external peer dependency or peer test lane", async () => {
    const pkg = await readJson(path.join(runtimeRoot, "package.json"));
    expect(pkg.name).toBe("@cursor-goal/runtime");

    const dependencies = (pkg.dependencies ?? {}) as Record<string, unknown>;
    expect(dependencies).not.toHaveProperty(`${forbiddenScope}/${forbiddenIntent}`);

    expect(pkg).not.toHaveProperty("peerDependencies");
    expect(pkg).not.toHaveProperty("peerDependenciesMeta");

    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.test).toBe("npm run build && vitest --run");
    expect(scripts).not.toHaveProperty("test:standalone");
    expect(scripts).not.toHaveProperty(`test:${forbiddenIntent}`);
    expect(JSON.stringify(scripts)).not.toMatch(new RegExp(`${forbiddenIntent}|${forbiddenScope}`));
  });

  it("does not ship external intent-kernel runtime adapters or env-gated branches", async () => {
    const libFiles = await readdir(path.join(runtimeRoot, "src/lib"));
    expect(libFiles).not.toContain("pi-stop.ts");
    expect(libFiles).not.toContain("pi-session.ts");
    expect(libFiles).not.toContain("pi-pre-tool.ts");
    expect(libFiles).not.toContain(`pi-${"intent"}-bridge.ts`);

    const files = await collectFiles(path.join(runtimeRoot, "src"));
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      expect(contents).not.toMatch(
        new RegExp(`${forbiddenIntent}|${forbiddenScope}|${forbiddenEnv}`),
      );
    }
  });

  it("does not keep legacy pioff runtime resolution aliases", async () => {
    const files = [
      path.join(cursorGoalRoot, "core/.cursor/hooks/_cgr-lib.sh"),
      path.join(cursorGoalRoot, "core/install.sh"),
      path.join(cursorGoalRoot, "supervisor/run-goal.mjs"),
      path.join(runtimeRoot, "src/lib/doctor.ts"),
    ];
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      expect(contents).not.toContain(`${forbiddenScope}/cursor-goal-runtime`);
      expect(contents).not.toContain(forbiddenNestedRuntime);
    }
  });

  it("does not expose external intent-kernel scripts, CI, schemas, or docs from cursor-goal", async () => {
    const files = [
      path.join(cursorGoalRoot, ".github/workflows/ci.yml"),
      path.join(cursorGoalRoot, "AGENTS.md"),
      path.join(cursorGoalRoot, "README.md"),
      path.join(cursorGoalRoot, "CAPABILITY.md"),
      path.join(cursorGoalRoot, "INVARIANTS.json"),
      path.join(cursorGoalRoot, "core/.cursor/goal/schemas/agent-runtime-state.json"),
      path.join(cursorGoalRoot, "core/.cursor/goal/schemas/runtime-state.json"),
      path.join(cursorGoalRoot, "scripts/install-global.sh"),
    ];
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      expect(contents).not.toMatch(
        new RegExp(`${forbiddenIntent}|${forbiddenScope}|${forbiddenEnv}|${forbiddenPeerScript}`),
      );
    }
  });
});
