#!/usr/bin/env node
import { mkdir, readdir, rm, stat, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, process.argv[2] || ".dist-build");
const target = path.resolve(root, process.argv[3] || "dist");

async function copyTree(from, to) {
  const info = await stat(from);
  if (info.isDirectory()) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from)) {
      await copyTree(path.join(from, entry), path.join(to, entry));
    }
    return;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function pruneTree(reference, live) {
  let entries;
  try {
    entries = await readdir(live);
  } catch {
    return;
  }
  for (const entry of entries) {
    const livePath = path.join(live, entry);
    const referencePath = path.join(reference, entry);
    let referenceInfo;
    try {
      referenceInfo = await stat(referencePath);
    } catch {
      await rm(livePath, { recursive: true, force: true });
      continue;
    }
    const liveInfo = await stat(livePath);
    if (referenceInfo.isDirectory() && liveInfo.isDirectory()) {
      await pruneTree(referencePath, livePath);
    }
  }
}

await mkdir(target, { recursive: true });
await copyTree(source, target);
await pruneTree(source, target);
await rm(source, { recursive: true, force: true });
console.log(`Published ${path.relative(root, target) || target}`);
