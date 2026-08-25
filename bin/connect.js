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
const SITE_URL = "https://openspender.com";
const WIN = process.platform === "win32";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const openBrowser = (url) => {
  try {
    if (WIN) spawnSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    else if (process.platform === "darwin")
      spawnSync("open", [url], { stdio: "ignore" });
    else spawnSync("xdg-open", [url], { stdio: "ignore" });
  } catch {
    /* the URL is printed either way */
  }
};

/* One browser approval for the whole machine: the server mints a card per
   detected tool and this terminal collects them on its next poll. Returns
   a Map of harness label → card token, or null (denied, expired, offline)
   — in which case configs are still written and each tool authenticates
   itself on first use. */
async function deviceAuth(labels) {
  try {
    const startRes = await fetch(`${SITE_URL}/api/oauth/device/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ harnesses: labels }),
    });
    if (!startRes.ok) return null;
    const { device_code, verify_url, interval = 2, expires_in = 600 } =
      await startRes.json();
    console.log(`Approve this machine in your browser:\n  ${verify_url}\n`);
    openBrowser(verify_url);

    const deadline = Date.now() + expires_in * 1000;
    while (Date.now() < deadline) {
      await sleep(Math.max(interval, 2) * 1000);
      let j;
      try {
        const r = await fetch(`${SITE_URL}/api/oauth/device/poll`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ device_code }),
        });
        if (!r.ok) continue;
        j = await r.json();
      } catch {
        continue; // transient network blip — keep polling
      }
      if (j.status === "approved")
        return new Map(j.cards.map((c) => [c.harness, c.token]));
      if (j.status === "denied") {
        console.log("Denied in the browser — wiring without auth instead.\n");
        return null;
      }
      if (j.status !== "pending") return null;
    }
    console.log("Timed out waiting for approval — wiring without auth.\n");
    return null;
  } catch {
    return null;
  }
}

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

const HARNESSES = [
  ["Claude Code", wireClaudeCode],
  ["Codex", wireCodex],
  ["opencode", wireOpencode],
  ["Gemini CLI", wireGemini],
  ["Cursor", wireCursor],
];

/* ── the agent skill ──────────────────────────────────────────────────
   Wiring makes the tools reachable; the skill makes them a habit — when
   to reach for the catalog, how to treat caps and costs, how to escalate.
   It is fetched from the canonical URL at connect time so every run
   installs the current version and nothing here goes stale.

   Where a harness has a skills directory it gets the full file; harnesses
   that read a global memory file get a compact block between our own
   markers. Rerunning replaces only what sits between those markers —
   everything else in the user's files stays byte-identical. ── */

const SKILL_URL = `${SITE_URL}/SKILL.md`;
const MARK_START = "<!-- openspender:skill -->";
const MARK_END = "<!-- /openspender:skill -->";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function fetchSkill() {
  try {
    const r = await fetch(SKILL_URL);
    if (!r.ok) return null;
    const text = await r.text();
    return text.startsWith("---") ? text : null; // frontmatter expected
  } catch {
    return null;
  }
}

const skillVersion = (skill) =>
  /version:\s*(\S+)/.exec(skill)?.[1] ?? "unknown";

function memoryBlock(skill) {
  return [
    MARK_START,
    `<!-- v${skillVersion(skill)} — managed by \`npx openspender connect\`; edits inside this block are overwritten -->`,
    "## openspender",
    "Paid APIs on the user's allowance — web search, frontier models, image",
    "and video generation, and a machine-payable catalog — every call priced",
    "before it is paid and capped by budgets the user set. The `openspender`",
    "MCP server carries the tools: catalog_search, call, chat, search,",
    "generate, balance, whoami, cards, activity.",
    "",
    "- Check `catalog_search` BEFORE writing a scraper, BEFORE saying",
    "  something needs an API key, and BEFORE declaring a source",
    "  inaccessible — the catalog grows; look first.",
    "- The user's own dedicated tools and keys come first: openspender",
    "  spends their balance. Offer it when it adds capability; never",
    "  silently switch.",
    "- A denial is the user's budget working. Name the cap and the price you",
    "  saw; never retry it verbatim or split work to duck it. Raising caps",
    "  is theirs: https://openspender.com/cards",
    "- Say what things cost — every paid result carries cost_usd and tx.",
    "- Tool responses may carry `hints`: prefer them over guessing.",
    "- Full skill (keep it current): https://openspender.com/SKILL.md",
    MARK_END,
  ].join("\n");
}

function upsertBlock(path, block, dryRun) {
  const have = existsSync(path) ? readFileSync(path, "utf8") : "";
  const re = new RegExp(
    `${escapeRe(MARK_START)}[\\s\\S]*?${escapeRe(MARK_END)}`,
  );
  const next = re.test(have)
    ? have.replace(re, block)
    : have
      ? `${have.replace(/\n*$/, "\n\n")}${block}\n`
      : `${block}\n`;
  if (next === have) return false;
  if (!dryRun) writeOut(path, next);
  return true;
}

function installSkillFile(dir, skill, dryRun) {
  const path = join(dir, "SKILL.md");
  const have = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (have === skill) return false;
  if (!dryRun) writeOut(path, skill);
  return true;
}

/* Skill homes, by harness label. `file` gets the whole skill; `block` gets
   the compact form in that harness's global memory file. Cursor has no
   global rules file to write — its sessions read the server's tool
   descriptions, which carry the same triggers. */
const SKILL_HOMES = {
  "Claude Code": {
    kind: "file",
    dir: () => join(homedir(), ".claude", "skills", "openspender"),
  },
  Codex: { kind: "block", path: () => join(homedir(), ".codex", "AGENTS.md") },
  opencode: {
    kind: "block",
    path: () => join(homedir(), ".config", "opencode", "AGENTS.md"),
  },
  "Gemini CLI": {
    kind: "block",
    path: () => join(homedir(), ".gemini", "GEMINI.md"),
  },
};

async function installSkills(outcomes, dryRun) {
  const eligible = outcomes.filter(
    (x) =>
      (x.status === "wired" ||
        x.status === "already" ||
        x.status === "would wire") &&
      SKILL_HOMES[x.harness],
  );
  if (!eligible.length) return;
  const skill = await fetchSkill();
  if (!skill) {
    console.log(
      `\nSkill: couldn't fetch ${SKILL_URL} — rerun \`npx openspender connect\` later to install it.`,
    );
    return;
  }
  const landed = [];
  for (const x of eligible) {
    const home = SKILL_HOMES[x.harness];
    const changed =
      home.kind === "file"
        ? installSkillFile(home.dir(), skill, dryRun)
        : upsertBlock(home.path(), memoryBlock(skill), dryRun);
    landed.push(`${x.harness}${changed ? "" : " (already current)"}`);
  }
  const verb = dryRun ? "would install for" : "installed for";
  console.log(
    `\nSkill v${skillVersion(skill)} ${verb}: ${landed.join(", ")}.` +
      (outcomes.some((x) => x.harness === "Cursor" && x.status !== "skipped")
        ? "\nCursor reads the same guidance from the server's tool descriptions."
        : ""),
  );
}

export async function runConnect(rest) {
  const dryRun = rest.includes("--dry-run");
  const force = rest.includes("--force");
  const noAuth = rest.includes("--no-auth");
  const noSkill = rest.includes("--no-skill");
  const cardIdx = rest.indexOf("--card");
  const card = cardIdx >= 0 ? rest[cardIdx + 1] : undefined;
  if (card && !card.startsWith("openspender_")) {
    console.error("--card wants an allowance token (openspender_…)");
    process.exit(1);
  }

  console.log(
    `openspender connect — ${MCP_URL}${dryRun ? "  (dry run)" : ""}\n`,
  );

  // Detection pass (writes nothing). Only tools that will actually be
  // (re)wired ask for cards: an already-connected tool must not mint a
  // duplicate on every rerun — its config would keep the old card anyway,
  // orphaning the new one. (--force reports those as rewirable, so it
  // naturally mints fresh cards for the rewrite.)
  const probe = HARNESSES.map(([label, fn]) => [
    label,
    fn({ dryRun: true, force }),
  ]);
  const present = probe
    .filter(([, out]) => out.status === "would wire")
    .map(([label]) => label);

  // One approval for the machine, unless the caller opted out or brought
  // a card of their own. Failure is never fatal: configs still land and
  // each tool can authenticate itself on first use.
  let tokens = null;
  if (!dryRun && !noAuth && !card && present.length)
    tokens = await deviceAuth(present);

  const outcomes = HARNESSES.map(([label, fn]) =>
    fn({ dryRun, force, card: tokens?.get(label) ?? card }),
  );
  const pad = Math.max(...outcomes.map((x) => x.harness.length)) + 2;
  for (const x of outcomes)
    console.log(`  ${x.harness.padEnd(pad)}${x.status.padEnd(12)}${x.detail}`);

  const count = (s) => outcomes.filter((x) => x.status === s).length;
  const summary = dryRun
    ? `${count("would wire")} would wire`
    : `${count("wired")} wired, ${count("already")} already, ${count("failed")} failed`;
  console.log(`\n${summary}, ${count("skipped")} not present.`);

  // The skill rides along wherever a harness is (or would be) connected.
  if (!noSkill) await installSkills(outcomes, dryRun);
  if (tokens)
    console.log(
      "Authenticated: each tool has its own card. Caps, activity, and\n" +
        "revocation live at https://openspender.com/wallet",
    );
  else if (!card && !dryRun)
    console.log(
      "Each connection runs a one-time consent in your browser and mints its\n" +
        "own card — caps and revocation live at https://openspender.com/wallet",
    );
}
