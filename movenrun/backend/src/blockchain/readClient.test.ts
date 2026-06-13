/**
 * Read-only client surface tests. These construct the client offline
 * (staticNetwork provider + on-disk deployment — no RPC call) and assert the
 * surface is genuinely read-only. No network access required.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBaseSepoliaReadClient } from "./readClient.js";
import { CONTRACT_READ_ABIS } from "./abis.js";
import { EXPECTED_CONTRACTS } from "./deployments.js";

test("client constructs offline and summarizes the deployment", () => {
  const client = createBaseSepoliaReadClient("https://sepolia.base.org");
  const summary = client.getDeploymentSummary();
  assert.equal(summary.chainId, 84532);
  assert.equal(summary.network, "baseSepolia");
  assert.equal(
    Object.keys(summary.addresses).length,
    EXPECTED_CONTRACTS.length,
  );
});

test("client exposes no signer / wallet / write methods", () => {
  const client = createBaseSepoliaReadClient("https://sepolia.base.org") as unknown as Record<
    string,
    unknown
  >;
  for (const banned of [
    "signer",
    "wallet",
    "sendTransaction",
    "signMessage",
    "privateKey",
    "write",
  ]) {
    assert.equal(client[banned], undefined, `client should not expose ${banned}`);
  }
});

test("read-only contracts use the provider as runner and expose only view fns", () => {
  const client = createBaseSepoliaReadClient("https://sepolia.base.org");
  for (const name of EXPECTED_CONTRACTS) {
    const c = client.getReadOnlyContract(name);
    // Runner is the provider, never a signer.
    assert.equal(c.runner, client.provider);
    // Every function fragment in the ABI is read-only.
    for (const frag of c.interface.fragments) {
      if (frag.type === "function") {
        const fn = frag as { stateMutability: string };
        assert.ok(
          fn.stateMutability === "view" || fn.stateMutability === "pure",
          `${name} ABI must contain only view/pure functions`,
        );
      }
    }
  }
});

test("every expected contract has a read ABI", () => {
  for (const name of EXPECTED_CONTRACTS) {
    assert.ok(CONTRACT_READ_ABIS[name], `no ABI for ${name}`);
    assert.ok(CONTRACT_READ_ABIS[name].length > 0);
  }
});
