// openspender connect — wire every AI harness on this machine to the
// hosted MCP server in one pass. Detection is conservative: a harness is
// configured only if its binary or config already exists here; nothing is
// installed and nothing is created for tools you don't have.
//
// Auth: by default each harness runs the OAuth consent on first use and
// mints its own card. --card <openspender_…> embeds a card header instead
// (headless boxes, CI) where the harness config supports it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const MCP_URL = "https://openspender.com/api/mcp";
const WIN = process.platform === "win32";

const binaryExists = (name) => {
  try {
    const r = spawnSync(name, ["--version"], {
      shell: WIN,
      timeout: 15_000,
      stdio: "pipe",
    });
    return r.status === 0;
  } catch {
    return false;
  }
};

/* Windows editors and shells love BOMs; strip before parsing. A file that
   EXISTS but will not parse is sacred — report it, never overwrite it. */
const readJson = (path) => {
  if (!existsSync(path)) return { state: "absent" };
  try {
    const text = readFileSync(path, "utf8");
    const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return { state: "ok", json: JSON.parse(raw) };
  } catch {
    return { state: "broken" };
  }
};

const writeOut = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

/* ── Claude Code: its own CLI is the config interface ── */
export function wireClaudeCode(o) {
  const harness = "Claude Code";
  if (!binaryExists("claude"))
    return { harness, status: "skipped", detail: "claude not on PATH" };

  const probe = spawnSync("claude", ["mcp", "get", "openspender"], {
    shell: WIN,
    timeout: 20_000,
    stdio: "pipe",
  });
  if (probe.status === 0 && !o.force)
    return { harness, status: "already", detail: "server already registered" };

  const args = [
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    "user",
    ...(o.card ? ["--header", `Authorization: Bearer ${o.card}`] : []),
    "openspender",
    MCP_URL,
  ];
  if (o.dryRun)
    return { harness, status: "would wire", detail: `claude ${args.join(" ")}` };
  const r = spawnSync("claude", args, {
    shell: WIN,
    timeout: 30_000,
    stdio: "pipe",
  });
  if (r.status !== 0)
    return {
      harness,
      status: "failed",
      detail: (r.stderr?.toString() ?? "claude mcp add failed").slice(0, 120),
    };
  return {
    harness,
    status: "wired",
    detail: o.card
      ? "card header set"
      : "OAuth consent opens on first use (/mcp in a session)",
  };
}

/* ── Codex: ~/.codex/config.toml, [mcp_servers.openspender] ── */
export function wireCodex(o) {
  const harness = "Codex";
  const path = join(homedir(), ".codex", "config.toml");
  const present = existsSync(path) || binaryExists("codex");
  if (!present)
    return { harness, status: "skipped", detail: "no ~/.codex and no binary" };

  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current.includes("[mcp_servers.openspender]") && !o.force)
    return { harness, status: "already", detail: path };

  if (o.dryRun)
    return { harness, status: "would wire", detail: `append to ${path}` };
  writeOut(path, current + `\n[mcp_servers.openspender]\nurl = "${MCP_URL}"\n`);
  return {
    harness,
    status: "wired",
    detail: "then run: codex mcp login openspender",
  };
}

/* ── opencode: ~/.config/opencode/opencode.json, mcp.openspender ── */
export function wireOpencode(o) {
  const harness = "opencode";
  const path = join(homedir(), ".config", "opencode", "opencode.json");
  const present =
    existsSync(path) || existsSync(dirname(path)) || binaryExists("opencode");
  if (!present)
    return { harness, status: "skipped", detail: "not found on this machine" };

  const read = readJson(path);
  if (read.state === "broken")
    return {
      harness,
      status: "failed",
      detail: `${path} is not valid JSON — left untouched`,
    };
  const json =
    read.state === "ok"
      ? read.json
      : { $schema: "https://opencode.ai/config.json" };
  const mcp = json.mcp ?? {};
  if (mcp.openspender && !o.force)
    return { harness, status: "already", detail: path };
  mcp.openspender = {
    type: "remote",
    url: MCP_URL,
    enabled: true,
    ...(o.card ? { headers: { Authorization: `Bearer ${o.card}` } } : {}),
  };
  json.mcp = mcp;
  if (o.dryRun)
    return { harness, status: "would wire", detail: `merge into ${path}` };
  writeOut(path, JSON.stringify(json, null, 2) + "\n");
  return { harness, status: "wired", detail: path };
}

/* ── Gemini CLI: ~/.gemini/settings.json, mcpServers.openspender ── */
export function wireGemini(o) {
  const harness = "Gemini CLI";
  const path = join(homedir(), ".gemini", "settings.json");
  const present =
    existsSync(path) || existsSync(dirname(path)) || binaryExists("gemini");
  if (!present)
    return { harness, status: "skipped", detail: "not found on this machine" };

  const read = readJson(path);
  if (read.state === "broken")
    return {
      harness,
      status: "failed",
      detail: `${path} is not valid JSON — left untouched`,
    };
  const json = read.state === "ok" ? read.json : {};
  const servers = json.mcpServers ?? {};
  if (servers.openspender && !o.force)
    return { harness, status: "already", detail: path };
  servers.openspender = {
    httpUrl: MCP_URL,
    ...(o.card ? { headers: { Authorization: `Bearer ${o.card}` } } : {}),
  };
  json.mcpServers = servers;
  if (o.dryRun)
    return { harness, status: "would wire", detail: `merge into ${path}` };
  writeOut(path, JSON.stringify(json, null, 2) + "\n");
  return { harness, status: "wired", detail: path };
}

/* ── Cursor: ~/.cursor/mcp.json, mcpServers.openspender ── */
export function wireCursor(o) {
  const harness = "Cursor";
  const path = join(homedir(), ".cursor", "mcp.json");
  const present = existsSync(path) || existsSync(dirname(path));
  if (!present)
    return { harness, status: "skipped", detail: "not found on this machine" };

  const read = readJson(path);
  if (read.state === "broken")
    return {
      harness,
      status: "failed",
      detail: `${path} is not valid JSON — left untouched`,
    };
  const json = read.state === "ok" ? read.json : {};
  const servers = json.mcpServers ?? {};
  if (servers.openspender && !o.force)
    return { harness, status: "already", detail: path };
  servers.openspender = {
    url: MCP_URL,
    ...(o.card ? { headers: { Authorization: `Bearer ${o.card}` } } : {}),
  };
  json.mcpServers = servers;
  if (o.dryRun)
    return { harness, status: "would wire", detail: `merge into ${path}` };
  writeOut(path, JSON.stringify(json, null, 2) + "\n");
  return { harness, status: "wired", detail: "restart Cursor to pick it up" };
}

export function runConnect(rest) {
  const dryRun = rest.includes("--dry-run");
  const force = rest.includes("--force");
  const cardIdx = rest.indexOf("--card");
  const card = cardIdx >= 0 ? rest[cardIdx + 1] : undefined;
  if (card && !card.startsWith("openspender_")) {
    console.error("--card wants an allowance token (openspender_…)");
    process.exit(1);
  }
  const o = { dryRun, force, card };

  console.log(
    `openspender connect — ${MCP_URL}${dryRun ? "  (dry run)" : ""}\n`,
  );
  const outcomes = [
    wireClaudeCode(o),
    wireCodex(o),
    wireOpencode(o),
    wireGemini(o),
    wireCursor(o),
  ];
  const pad = Math.max(...outcomes.map((x) => x.harness.length)) + 2;
  for (const x of outcomes)
    console.log(`  ${x.harness.padEnd(pad)}${x.status.padEnd(12)}${x.detail}`);

  const count = (s) => outcomes.filter((x) => x.status === s).length;
  const summary = dryRun
    ? `${count("would wire")} would wire`
    : `${count("wired")} wired, ${count("already")} already, ${count("failed")} failed`;
  console.log(`\n${summary}, ${count("skipped")} not present.`);
  if (!card)
    console.log(
      "Each connection runs a one-time consent in your browser and mints its\n" +
        "own card — caps and revocation live at https://openspender.com/wallet",
    );
}
