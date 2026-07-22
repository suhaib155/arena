/**
 * Profile identity view — offline node tests. Verifies signed-in vs local,
 * wallet present/unavailable (embedded vs linked), one primary action per
 * state, and that NO secret/internal identifier is exposed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProfileIdentity, type ProfileIdentityInput } from "../profileView";

function input(p: Partial<ProfileIdentityInput> = {}): ProfileIdentityInput {
  return { authStatus: "signedOut", hasUser: false, walletCount: 0, hasEmbeddedWallet: false, ...p };
}

test("local profile when signed out", () => {
  const v = buildProfileIdentity(input());
  assert.equal(v.signedIn, false);
  assert.equal(v.statusLabel, "Local profile");
  assert.equal(v.statusTone, "neutral");
  assert.equal(v.primaryActionLabel, "Sign in");
});

test("signed in requires both signedIn status and a user object", () => {
  assert.equal(buildProfileIdentity(input({ authStatus: "signedIn", hasUser: false })).signedIn, false);
  const v = buildProfileIdentity(input({ authStatus: "signedIn", hasUser: true }));
  assert.equal(v.signedIn, true);
  assert.equal(v.statusLabel, "Signed in");
  assert.equal(v.primaryActionLabel, "Account & Security");
});

test("wallet unavailable vs present (embedded vs linked)", () => {
  assert.equal(buildProfileIdentity(input()).walletLabel, "No wallet yet");
  assert.equal(buildProfileIdentity(input()).walletAvailable, false);
  assert.equal(buildProfileIdentity(input({ walletCount: 1, hasEmbeddedWallet: true })).walletLabel, "Embedded wallet");
  assert.equal(buildProfileIdentity(input({ walletCount: 1, hasEmbeddedWallet: false })).walletLabel, "Wallet linked");
  assert.equal(buildProfileIdentity(input({ walletCount: 1 })).walletAvailable, true);
});

test("view exposes only labels/booleans — no id/address/token/secret", () => {
  const v = buildProfileIdentity(input({ authStatus: "signedIn", hasUser: true, walletCount: 1, hasEmbeddedWallet: true }));
  const keys = Object.keys(v);
  for (const forbidden of ["id", "userId", "address", "token", "secret", "sessionId", "seed", "privateKey"]) {
    assert.ok(!keys.includes(forbidden), `identity view must not expose ${forbidden}`);
  }
});
