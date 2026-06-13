/**
 * Deployment-loader tests. No network access, no extra deps (node:test + tsx).
 * These read the real contracts/deployments/baseSepolia.json on disk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadDeployment,
  getContractAddress,
  validateAddresses,
  crossCheckRegistry,
  isValidAddress,
  EXPECTED_CONTRACTS,
  type ContractName,
} from "./deployments.js";
import {
  InvalidAddressError,
  MissingContractAddressError,
  MissingDeploymentError,
  UnsupportedNetworkError,
} from "./errors.js";

test("deployment JSON loads with the right network and chain id", () => {
  const d = loadDeployment("baseSepolia");
  assert.equal(d.network, "baseSepolia");
  assert.equal(d.chainId, 84532);
});

test("all expected contracts exist with valid addresses", () => {
  const d = loadDeployment("baseSepolia");
  for (const name of EXPECTED_CONTRACTS) {
    assert.ok(d.addresses[name], `missing ${name}`);
    assert.ok(isValidAddress(d.addresses[name]), `invalid ${name}`);
  }
  assert.equal(Object.keys(d.addresses).length, EXPECTED_CONTRACTS.length);
});

test("registry cross-check passes against the real deployment", () => {
  const d = loadDeployment("baseSepolia");
  assert.doesNotThrow(() => crossCheckRegistry(d.addresses, "baseSepolia"));
});

test("getContractAddress returns the address by name", () => {
  const addr = getContractAddress("MoveToken", "baseSepolia");
  assert.ok(isValidAddress(addr));
  assert.equal(addr, loadDeployment("baseSepolia").addresses.MoveToken);
});

test("loadDeployment throws a typed error for an unsupported network", () => {
  assert.throws(() => loadDeployment("mainnet"), UnsupportedNetworkError);
});

test("validateAddresses throws when a contract address is missing", () => {
  const partial = { MoveToken: "0x" + "1".repeat(40) } as Record<
    ContractName,
    string
  >;
  assert.throws(
    () => validateAddresses(partial, "baseSepolia"),
    MissingContractAddressError,
  );
});

test("validateAddresses throws on a malformed address", () => {
  const bad: Record<ContractName, string> = Object.fromEntries(
    EXPECTED_CONTRACTS.map((n) => [n, "0x" + "1".repeat(40)]),
  ) as Record<ContractName, string>;
  bad.ZoneNFT = "0xnothex";
  assert.throws(
    () => validateAddresses(bad, "baseSepolia"),
    InvalidAddressError,
  );
});

test("crossCheckRegistry throws on a registry/deployment mismatch", () => {
  const drifted: Record<ContractName, string> = Object.fromEntries(
    EXPECTED_CONTRACTS.map((n) => [n, "0x" + "a".repeat(40)]),
  ) as Record<ContractName, string>;
  assert.throws(
    () => crossCheckRegistry(drifted, "baseSepolia"),
    MissingDeploymentError,
  );
});

test("isValidAddress accepts 0x+40hex and rejects others", () => {
  assert.ok(isValidAddress("0x" + "abcdef0123".repeat(4)));
  assert.ok(!isValidAddress("0x123"));
  assert.ok(!isValidAddress("zzzz"));
  assert.ok(!isValidAddress(123 as unknown));
});
