import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

describe("I117 upgrade strict args", () => {
  let tempDir: string;

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects unsupported upgrade args before invoking the installer", async () => {
    tempDir = path.join(os.tmpdir(), `i117-upgrade-${Date.now()}`);
    const fakeBin = path.join(tempDir, "bin");
    const marker = path.join(tempDir, "installer-invoked");
    await mkdir(fakeBin, { recursive: true });
    const fakeBash = path.join(fakeBin, "bash");
    await writeFile(fakeBash, "#!/bin/sh\nprintf invoked > \"$I117_MARKER\"\nexit 0\n", "utf8");
    await chmod(fakeBash, 0o755);

    const cli = path.resolve(import.meta.dirname, "../../dist/cli.js");
    const r = spawnSync("node", [cli, "upgrade", "--upgarde"], {
      encoding: "utf8",
      env: {
        ...process.env,
        I117_MARKER: marker,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
    });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown option: --upgarde/);
    expect(existsSync(marker)).toBe(false);
  });
});
