/**
 * Network presentation view — offline node tests. Verifies signed-in vs local,
 * wallet none/embedded/linked, the dominant off-chain line, one primary action
 * per state, honest wording (no verified/synced/live/finalized/secure), and
 * that the output exposes only labels — no address/id/token/secret.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNetworkView, type NetworkViewInput } from "../networkView";

function input(p: Partial<NetworkViewInput> = {}): NetworkViewInput {
  return { authStatus: "signedOut", hasUser: false, walletCount: 0, hasEmbeddedWallet: false, ...p };
}

function row(v: ReturnType<typeof buildNetworkView>, key: string) {
  return v.rows.find((r) => r.key === key)!;
}

test("signed out → local profile account, Sign in action", () => {
  const v = buildNetworkView(input());
  assert.equal(v.signedIn, false);
  assert.equal(row(v, "account").value, "Local profile");
  assert.equal(v.primaryActionLabel, "Sign in");
});

test("signed in requires status + user; then Account & Security", () => {
  assert.equal(buildNetworkView(input({ authStatus: "signedIn", hasUser: false })).signedIn, false);
  const v = buildNetworkView(input({ authStatus: "signedIn", hasUser: true }));
  assert.equal(v.signedIn, true);
  assert.equal(row(v, "account").value, "Signed in");
  assert.equal(v.primaryActionLabel, "Account & Security");
});

test("wallet none / embedded / linked", () => {
  assert.equal(row(buildNetworkView(input()), "wallet").value, "No wallet");
  assert.equal(row(buildNetworkView(input({ walletCount: 1, hasEmbeddedWallet: true })), "wallet").value, "Embedded wallet");
  assert.equal(row(buildNetworkView(input({ walletCount: 1, hasEmbeddedWallet: false })), "wallet").value, "Wallet linked");
});

test("dominant line distinguishes chain foundation from off-chain gameplay", () => {
  const v = buildNetworkView(input());
  assert.match(v.dominantLabel, /Base Sepolia/);
  assert.match(v.dominantDetail, /off-chain/i);
  assert.equal(row(v, "gameplay").value, "On-device · off-chain");
  assert.equal(row(v, "chain").value, "Base Sepolia · deployed");
});

test("never claims verified/synced/live/finalized/secure", () => {
  const v = buildNetworkView(input({ authStatus: "signedIn", hasUser: true, walletCount: 1, hasEmbeddedWallet: true }));
  const blob = JSON.stringify(v).toLowerCase();
  for (const forbidden of ["verified", "synced", " live", "finalized", "secure", "confirmed"]) {
    assert.ok(!blob.includes(forbidden), `must not claim ${forbidden.trim()}`);
  }
});

test("output exposes only labels — no address/id/token/secret", () => {
  const v = buildNetworkView(input({ authStatus: "signedIn", hasUser: true, walletCount: 1, hasEmbeddedWallet: true }));
  const keys = [...Object.keys(v), ...v.rows.flatMap((r) => Object.keys(r))];
  for (const forbidden of ["address", "userId", "token", "sessionId", "apiKey", "secret", "privateKey", "seed"]) {
    assert.ok(!keys.includes(forbidden), `must not expose ${forbidden}`);
  }
});
