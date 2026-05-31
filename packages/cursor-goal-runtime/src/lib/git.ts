import { execSync } from "node:child_process";

export function isGitRepo(root: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
