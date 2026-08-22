# openspender

CLI and JavaScript client for [OpenSpender](https://openspender.com) — the self-custodial
wallet that lets AI agents like Claude Code pay for models, search, video, and compute
as they go. Load once, then your agent buys what it needs, billed per call with no
markup and no subscriptions.

OpenSpender routes requests to 15,000+ machine-payable endpoints across the
[x402](https://openspender.com/services) and [MPP](https://openspender.com/mpp)
payment standards.

## Connect every AI tool at once

```sh
npx openspender connect
```

Detects Claude Code, Codex, opencode, Gemini CLI, and Cursor, opens one browser
approval, and wires every detected tool to OpenSpender's MCP server — each with
its own freshly minted card at caps chosen on the consent screen. Tools are
authenticated the moment the command finishes. Caps, activity, and revocation
live at [openspender.com/wallet](https://openspender.com/wallet).

Flags: `--dry-run` previews without writing, `--force` rewrites existing
entries, `--no-auth` skips the browser approval (each tool then authenticates
itself on first use), and `--card openspender_…` uses one existing card for
everything (headless machines, CI).

## Getting started

```sh
npx openspender init
```

This sets up your local config, checks connectivity, and walks you through the two
steps that happen in your browser and shell:

1. **Fund a wallet and mint an allowance token** at
   [openspender.com/wallet](https://openspender.com/wallet). OpenSpender is
   self-custodial — your keys, your money.
2. **Export the token** so your tools can spend against the allowance:

   ```sh
   export OPENSPENDER_ALLOWANCE_TOKEN="<your token>"
   ```

Existing SDKs work unchanged by pointing them at the router. For Claude:

```sh
export ANTHROPIC_BASE_URL="https://openspender.com/v1/anthropic"
export ANTHROPIC_AUTH_TOKEN="$OPENSPENDER_ALLOWANCE_TOKEN"
```

Check your setup any time with:

```sh
npx openspender status
```

## Library usage

Requires Node.js 18 or later.

```js
import { OpenSpender } from "openspender";

const client = new OpenSpender(); // reads OPENSPENDER_ALLOWANCE_TOKEN

// Call any machine-payable endpoint: POST https://openspender.com/v1/{provider}/{endpoint}
const result = await client.request("exa", "search", {
  query: "latest x402 ecosystem news",
});

// Public network stats (no token required)
const stats = await client.stats();
console.log(stats.totalServices);
```

When a provider responds with `402 Payment Required`, the OpenSpender router reads the
challenge, checks it against your allowance, pays, and replays the request — your code
just sees the result.

## Status

Early release under active development — the API surface may change before 1.0.
Feedback and issues are welcome at
[github.com/imkrishnamadala/openspender](https://github.com/imkrishnamadala/openspender/issues).

## Documentation

Full docs live at [openspender.com/docs](https://openspender.com/docs).

## Security

OpenSpender handles payments, so we take security seriously. Please report
vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

MIT
