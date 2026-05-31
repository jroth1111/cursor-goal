import { execSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type ProjectFixture = {
  dir: string;
  cleanup: () => Promise<void>;
};

export async function mkGitProject(prefix = "cgr"): Promise<ProjectFixture> {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(path.join(dir, ".cursor", "goal", "passports"), { recursive: true });
  await mkdir(path.join(dir, ".cursor", "hooks"), { recursive: true });
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  await writeFile(path.join(dir, ".gitkeep"), "", "utf8");
  execSync("git add -A && git commit -q -m init", { cwd: dir, shell: "/bin/bash" });
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export function installCoreHooks(projectDir: string): string {
  const coreHooks = path.resolve(
    import.meta.dirname,
    "../../../../core/.cursor/hooks",
  );
  return coreHooks;
}

export function withProjectEnv(dir: string): { restore: () => void } {
  const prev = process.env.CURSOR_PROJECT_DIR;
  process.env.CURSOR_PROJECT_DIR = dir;
  return {
    restore: () => {
      if (prev === undefined) delete process.env.CURSOR_PROJECT_DIR;
      else process.env.CURSOR_PROJECT_DIR = prev;
    },
  };
}
