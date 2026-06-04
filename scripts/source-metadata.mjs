#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function hashString(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function gitRaw(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0 ? r.stdout : "";
}

function git(root, args) {
  return gitRaw(root, args).trim();
}

function isGoalArtifact(rel) {
  const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  return norm === ".cursor/goal" || norm.startsWith(".cursor/goal/");
}

function hashFile(root, rel) {
  try {
    return createHash("sha256").update(readFileSync(path.join(root, rel))).digest("hex").slice(0, 16);
  } catch {
    return "missing";
  }
}

function parsePorcelainPath(line) {
  if (!line) return "";
  const raw = line.length >= 3 && line[2] === " " ? line.slice(3) : line.slice(2).trimStart();
  const renamed = raw.includes(" -> ") ? raw.split(" -> ").pop() ?? raw : raw;
  return renamed.trim().replace(/^"|"$/g, "");
}

export function computeSourceMetadata(root) {
  const head = git(root, ["rev-parse", "HEAD"]);
  const parts = head ? [`head:${head}`] : [];

  const diff = gitRaw(root, ["diff", "--binary", "HEAD", "--", ".", ":(exclude).cursor/goal"]);
  if (diff.trim()) parts.push(`diff:${hashString(diff)}`);

  const staged = gitRaw(root, ["diff", "--binary", "--cached", "HEAD", "--", ".", ":(exclude).cursor/goal"]);
  if (staged.trim()) parts.push(`staged:${hashString(staged)}`);

  const untracked = gitRaw(root, ["ls-files", "--others", "--exclude-standard"])
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((rel) => !isGoalArtifact(rel))
    .sort();
  for (const rel of untracked) {
    parts.push(`ut:${rel}:${hashFile(root, rel)}`);
  }

  const dirtyFiles = gitRaw(root, ["status", "--porcelain=v1", "--untracked-files=normal"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parsePorcelainPath)
    .filter(Boolean)
    .filter((rel) => !isGoalArtifact(rel))
    .sort();

  const cleanPartCount = head ? 1 : 0;
  const dirty = parts.length > cleanPartCount;
  const sourceTree = head
    ? dirty
      ? `${head}-wt-${hashString(parts.join("\n"))}`
      : head
    : dirty
      ? `uncommitted-wt-${hashString(parts.join("\n"))}`
      : "no-git";

  return {
    source_tree: sourceTree,
    source_dirty: dirty,
    source_dirty_files: dirtyFiles,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? process.cwd();
  console.log(JSON.stringify(computeSourceMetadata(root)));
}
