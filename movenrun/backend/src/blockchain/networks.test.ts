/**
 * Network-config tests. No network access, no extra deps (node:test + tsx).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_SEPOLIA,
  getNetwork,
  resolveRpcUrl,
} from "./networks.js";
import { UnsupportedNetworkError } from "./errors.js";

test("Base Sepolia config has the right chain id and env var", () => {
  assert.equal(BASE_SEPOLIA.name, "baseSepolia");
  assert.equal(BASE_SEPOLIA.chainId, 84532);
  assert.equal(BASE_SEPOLIA.rpcEnvVar, "BASE_SEPOLIA_RPC_URL");
});

test("getNetwork returns baseSepolia", () => {
  assert.equal(getNetwork("baseSepolia").chainId, 84532);
});

test("getNetwork throws a typed error for unsupported networks", () => {
  assert.throws(() => getNetwork("ethereum"), UnsupportedNetworkError);
  assert.throws(() => getNetwork("base"), UnsupportedNetworkError);
});

test("resolveRpcUrl prefers explicit override, then env, then fallback", () => {
  assert.equal(
    resolveRpcUrl(BASE_SEPOLIA, "https://example.test/rpc"),
    "https://example.test/rpc",
  );
  const prev = process.env.BASE_SEPOLIA_RPC_URL;
  try {
    delete process.env.BASE_SEPOLIA_RPC_URL;
    assert.equal(resolveRpcUrl(BASE_SEPOLIA), BASE_SEPOLIA.defaultRpcUrl);
    process.env.BASE_SEPOLIA_RPC_URL = "https://env.test/rpc";
    assert.equal(resolveRpcUrl(BASE_SEPOLIA), "https://env.test/rpc");
  } finally {
    if (prev === undefined) delete process.env.BASE_SEPOLIA_RPC_URL;
    else process.env.BASE_SEPOLIA_RPC_URL = prev;
  }
});
