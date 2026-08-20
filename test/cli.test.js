import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../bin/openspender.js", import.meta.url));
const pkg = createRequire(import.meta.url)("../package.json");

test("--help prints usage and exits 0", async () => {
  const { stdout } = await run(process.execPath, [CLI, "--help"]);
  assert.match(stdout, /Usage: openspender/);
  assert.match(stdout, /init/);
});

test("--version prints the package version", async () => {
  const { stdout } = await run(process.execPath, [CLI, "--version"]);
  assert.equal(stdout.trim(), pkg.version);
});

test("unknown commands exit non-zero with usage", async () => {
  await assert.rejects(
    () => run(process.execPath, [CLI, "frobnicate"]),
    (err) => err.code === 1 && /Unknown command: frobnicate/.test(err.stderr)
  );
});
