import test from "node:test";
import assert from "node:assert/strict";
import OpenSpenderDefault, { OpenSpender, OpenSpenderError, SITE_URL } from "../index.js";

test("default export is the OpenSpender class", () => {
  assert.equal(OpenSpenderDefault, OpenSpender);
});

test("defaults to the openspender.com base URL", () => {
  const client = new OpenSpender();
  assert.equal(client.baseUrl, SITE_URL);
});

test("strips trailing slashes from a custom base URL", () => {
  const client = new OpenSpender({ baseUrl: "https://staging.openspender.com///" });
  assert.equal(client.baseUrl, "https://staging.openspender.com");
});

test("takes the allowance token from options over the environment", () => {
  const client = new OpenSpender({ token: "tok_from_options" });
  assert.equal(client.token, "tok_from_options");
});

test("falls back to OPENSPENDER_ALLOWANCE_TOKEN from the environment", () => {
  const saved = process.env.OPENSPENDER_ALLOWANCE_TOKEN;
  process.env.OPENSPENDER_ALLOWANCE_TOKEN = "tok_from_env";
  try {
    const client = new OpenSpender();
    assert.equal(client.token, "tok_from_env");
  } finally {
    if (saved === undefined) delete process.env.OPENSPENDER_ALLOWANCE_TOKEN;
    else process.env.OPENSPENDER_ALLOWANCE_TOKEN = saved;
  }
});

test("request() rejects with a helpful error when no token is configured", async () => {
  const saved = process.env.OPENSPENDER_ALLOWANCE_TOKEN;
  delete process.env.OPENSPENDER_ALLOWANCE_TOKEN;
  try {
    const client = new OpenSpender();
    await assert.rejects(
      () => client.request("anthropic", "messages"),
      (err) => err instanceof OpenSpenderError && /allowance token/i.test(err.message)
    );
  } finally {
    if (saved !== undefined) process.env.OPENSPENDER_ALLOWANCE_TOKEN = saved;
  }
});
