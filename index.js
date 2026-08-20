/**
 * JavaScript client for OpenSpender (https://openspender.com) — the wallet
 * that lets AI agents pay for models, search, and compute as they go.
 *
 * Requests are routed as POST {baseUrl}/v1/{provider}/{endpoint} and
 * authenticated with an allowance token minted at https://openspender.com/wallet.
 */

export const SITE_URL = "https://openspender.com";

export class OpenSpenderError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, body?: unknown}} [details]
   */
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "OpenSpenderError";
    this.status = status;
    this.body = body;
  }
}

export class OpenSpender {
  /**
   * @param {object} [options]
   * @param {string} [options.baseUrl] Override the OpenSpender base URL.
   * @param {string} [options.token] Allowance token. Defaults to the
   *   OPENSPENDER_ALLOWANCE_TOKEN environment variable.
   */
  constructor({ baseUrl = SITE_URL, token } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token ?? process.env.OPENSPENDER_ALLOWANCE_TOKEN;
  }

  /**
   * Call a machine-payable endpoint through the OpenSpender router,
   * e.g. request("anthropic", "messages", {...}) or request("exa", "search", {...}).
   *
   * @param {string} provider Provider slug (e.g. "anthropic", "openai", "exa").
   * @param {string} endpoint Endpoint path under the provider (e.g. "messages").
   * @param {object} [body] JSON request body forwarded to the provider.
   * @param {{signal?: AbortSignal, headers?: Record<string, string>}} [options]
   * @returns {Promise<any>} Parsed JSON response.
   */
  async request(provider, endpoint, body = {}, { signal, headers } = {}) {
    if (!this.token) {
      throw new OpenSpenderError(
        "No allowance token. Mint one at https://openspender.com/wallet and set OPENSPENDER_ALLOWANCE_TOKEN."
      );
    }
    const url = `${this.baseUrl}/v1/${provider}/${endpoint.replace(/^\/+/, "")}`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
        "user-agent": "openspender-js",
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      throw new OpenSpenderError(`${provider}/${endpoint} failed with HTTP ${res.status}`, {
        status: res.status,
        body: json ?? text,
      });
    }
    return json ?? text;
  }

  /**
   * Fetch public network stats from openspender.com/stats.json.
   * No token required.
   * @param {{signal?: AbortSignal}} [options]
   * @returns {Promise<any>}
   */
  async stats({ signal } = {}) {
    const res = await fetch(`${this.baseUrl}/stats.json`, {
      signal,
      headers: { "user-agent": "openspender-js" },
    });
    if (!res.ok) {
      throw new OpenSpenderError(`stats.json failed with HTTP ${res.status}`, { status: res.status });
    }
    return res.json();
  }

  /**
   * Check that OpenSpender is reachable.
   * @returns {Promise<{ok: boolean, status: number, url: string}>}
   */
  async ping() {
    const res = await fetch(this.baseUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": "openspender-js" },
    });
    return { ok: res.ok, status: res.status, url: res.url };
  }
}

export default OpenSpender;
