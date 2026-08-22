#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { OpenSpender, SITE_URL } from "../index.js";
import { runConnect } from "./connect.js";

const pkg = createRequire(import.meta.url)("../package.json");

const CONFIG_DIR = join(homedir(), ".openspender");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function usage() {
  return `Usage: openspender <command>

Commands:
  connect  Wire every AI tool on this machine (Claude Code, Codex,
           opencode, Gemini CLI, Cursor) to the OpenSpender MCP server.
           Flags: --dry-run, --force, --card <openspender_…>
  init     Set up OpenSpender on this machine
  status   Show local setup and live network stats
  help     Show this message

Options:
  -v, --version  Print the package version

Docs: ${SITE_URL}/docs`;
}

async function readConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function envExample(name, value) {
  return process.platform === "win32"
    ? `$env:${name} = "${value}"`
    : `export ${name}="${value}"`;
}

async function init() {
  let config = await readConfig();
  if (config) {
    console.log(`Already initialized (${CONFIG_PATH}).`);
  } else {
    config = { baseUrl: SITE_URL };
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
    console.log(`Created ${CONFIG_PATH}.`);
  }

  const client = new OpenSpender({ baseUrl: config.baseUrl });
  try {
    const stats = await client.stats();
    console.log(
      `Connected to openspender.com — ${stats.totalServices.toLocaleString()} machine-payable services available.`
    );
  } catch {
    console.log("Could not reach openspender.com — check your network connection and try again.");
  }

  console.log(`
Next steps:

  1. Fund your wallet and mint an allowance token:
       ${SITE_URL}/wallet

  2. Make the token available to your tools:
       ${envExample("OPENSPENDER_ALLOWANCE_TOKEN", "<your token>")}

  3. Point a client at the router, e.g. for Claude:
       ${envExample("ANTHROPIC_BASE_URL", `${SITE_URL}/v1/anthropic`)}
       ${envExample("ANTHROPIC_AUTH_TOKEN", process.platform === "win32" ? "$env:OPENSPENDER_ALLOWANCE_TOKEN" : "$OPENSPENDER_ALLOWANCE_TOKEN")}

Full documentation: ${SITE_URL}/docs`);
}

async function status() {
  const config = await readConfig();
  if (config) {
    console.log(`Config:          ${CONFIG_PATH}`);
  } else {
    console.log("Config:          not initialized — run `openspender init` to get started");
  }
  console.log(
    `Allowance token: ${process.env.OPENSPENDER_ALLOWANCE_TOKEN ? "set (OPENSPENDER_ALLOWANCE_TOKEN)" : "not set — mint one at " + SITE_URL + "/wallet"}`
  );

  const client = new OpenSpender({ baseUrl: config?.baseUrl ?? SITE_URL });
  try {
    const stats = await client.stats();
    console.log(`Network:         reachable — ${stats.totalServices.toLocaleString()} services, ${stats.calls30d.toLocaleString()} calls in the last 30 days`);
  } catch {
    console.log("Network:         unreachable — check your connection");
  }
}

async function main() {
  if (typeof fetch !== "function") {
    console.error(`openspender requires Node.js 18 or later (found ${process.version}).`);
    process.exit(1);
  }
  const [command = "help"] = process.argv.slice(2);
  switch (command) {
    case "connect":
      runConnect(process.argv.slice(3));
      break;
    case "init":
      await init();
      break;
    case "status":
      await status();
      break;
    case "version":
    case "-v":
    case "--version":
      console.log(pkg.version);
      break;
    case "help":
    case "-h":
    case "--help":
      console.log(usage());
      break;
    default:
      console.error(`Unknown command: ${command}\n\n${usage()}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
