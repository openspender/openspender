import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MCP_URL,
  wireCodex,
  wireCursor,
  wireGemini,
  wireOpencode,
} from "../bin/connect.js";

/* os.homedir() reads USERPROFILE (Windows) / HOME (POSIX) at call time,
   so each test gets its own sandbox home. Claude Code is exercised by
   hand (it shells out to the real `claude`); everything else is here. */
const sandboxHome = () => {
  const home = mkdtempSync(join(tmpdir(), "osp-connect-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  return home;
};
const O = { dryRun: false, force: false };

test("cursor: wires, is idempotent, and preserves siblings", () => {
  const home = sandboxHome();
  mkdirSync(join(home, ".cursor"), { recursive: true });
  writeFileSync(
    join(home, ".cursor", "mcp.json"),
    JSON.stringify({ mcpServers: { other: { url: "https://example.com" } } }),
  );

  assert.equal(wireCursor(O).status, "wired");
  const json = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
  assert.equal(json.mcpServers.openspender.url, MCP_URL);
  assert.equal(json.mcpServers.other.url, "https://example.com");

  assert.equal(wireCursor(O).status, "already");
});

test("gemini: a BOM'd settings.json still merges and keeps its servers", () => {
  const home = sandboxHome();
  mkdirSync(join(home, ".gemini"), { recursive: true });
  writeFileSync(
    join(home, ".gemini", "settings.json"),
    "﻿" +
      JSON.stringify({ mcpServers: { other: { httpUrl: "https://example.com" } } }),
  );

  assert.equal(wireGemini(O).status, "wired");
  const json = JSON.parse(
    readFileSync(join(home, ".gemini", "settings.json"), "utf8"),
  );
  assert.equal(json.mcpServers.openspender.httpUrl, MCP_URL);
  assert.equal(json.mcpServers.other.httpUrl, "https://example.com");
});

test("broken JSON is reported and left byte-identical", () => {
  const home = sandboxHome();
  mkdirSync(join(home, ".cursor"), { recursive: true });
  const path = join(home, ".cursor", "mcp.json");
  writeFileSync(path, "{ this is not json");

  const out = wireCursor(O);
  assert.equal(out.status, "failed");
  assert.match(out.detail, /left untouched/);
  assert.equal(readFileSync(path, "utf8"), "{ this is not json");
});

test("dry run detects but writes nothing", () => {
  const home = sandboxHome();
  mkdirSync(join(home, ".cursor"), { recursive: true });
  const out = wireCursor({ ...O, dryRun: true });
  assert.equal(out.status, "would wire");
  assert.equal(existsSync(join(home, ".cursor", "mcp.json")), false);
});

test("codex: appends below existing config, idempotent", () => {
  const home = sandboxHome();
  mkdirSync(join(home, ".codex"), { recursive: true });
  const path = join(home, ".codex", "config.toml");
  writeFileSync(path, 'model = "gpt-5.2"\n');

  assert.equal(wireCodex(O).status, "wired");
  const toml = readFileSync(path, "utf8");
  assert.match(toml, /^model = "gpt-5\.2"/);
  assert.match(toml, /\[mcp_servers\.openspender\]/);
  assert.equal(wireCodex(O).status, "already");
});

test("--card embeds the header", () => {
  const home = sandboxHome();
  mkdirSync(join(home, ".cursor"), { recursive: true });
  wireCursor({ ...O, card: "openspender_testcard" });
  const json = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
  assert.equal(
    json.mcpServers.openspender.headers.Authorization,
    "Bearer openspender_testcard",
  );
});

test("opencode: creates config with schema when the dir exists bare", () => {
  const home = sandboxHome();
  mkdirSync(join(home, ".config", "opencode"), { recursive: true });
  assert.equal(wireOpencode(O).status, "wired");
  const json = JSON.parse(
    readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8"),
  );
  assert.equal(json.mcp.openspender.type, "remote");
  assert.equal(json.mcp.openspender.url, MCP_URL);
});
