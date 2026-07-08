/**
 * Oracle signature-alignment tests. No network, no extra deps (node:test + tsx).
 *
 * Each test reconstructs the EXACT digest the corresponding contract verifies
 * (mirroring contracts/src/*.sol `FIX-001` + contracts/test/*.test.ts) and
 * recovers the signer via ethers.verifyMessage — which applies the same EIP-191
 * prefix as the contracts' MessageHashUtils.toEthSignedMessageHash. A recovered
 * address equal to the oracle signer proves the backend signs the right tuple.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { OracleService, toHexIdUint64 } from "./oracle.service.js";

// Deterministic test key (Hardhat account #1) — not a real secret.
const TEST_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const CHAIN_ID = 84532n; // Base Sepolia
const ZERO = "0x0000000000000000000000000000000000000000";

const oracle = new OracleService({ privateKey: TEST_PK, chainId: CHAIN_ID });
const SIGNER = oracle.address;

const to = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const submitter = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const routeHash = ethers.keccak256(ethers.toUtf8Bytes("route-1"));
const HEX = "8a2a1072b59ffff"; // sample H3 index
const HEX_U64 = toHexIdUint64(HEX);
const MINT_COST = 500n * 10n ** 18n;

function recoverPacked(types: string[], values: unknown[], sig: string): string {
  const digest = ethers.solidityPackedKeccak256(types, values);
  return ethers.verifyMessage(ethers.getBytes(digest), sig);
}

test("toHexIdUint64 normalizes H3 strings and the 'no zone' sentinel", () => {
  assert.equal(toHexIdUint64("0"), 0n);
  assert.equal(toHexIdUint64(""), 0n);
  assert.equal(toHexIdUint64("0x0"), 0n);
  assert.equal(toHexIdUint64(HEX), BigInt("0x" + HEX));
  assert.equal(toHexIdUint64("0x" + HEX), BigInt("0x" + HEX));
});

test("signRouteProof verifies for GPSOracle.submitRoute (chainId,to,routeHash,distance,hexId)", async () => {
  const sig = await oracle.signRouteProof(to, routeHash, 20_000, HEX_U64);
  const recovered = recoverPacked(
    ["uint256", "address", "bytes32", "uint256", "uint64"],
    [CHAIN_ID, to, routeHash, 20_000n, HEX_U64],
    sig
  );
  assert.equal(recovered, SIGNER);
});

test("signZoneMint verifies for ZoneNFT.mintZone (chainId,hexId,minter,mintCost)", async () => {
  const sig = await oracle.signZoneMint(HEX, to, MINT_COST);
  const recovered = recoverPacked(
    ["uint256", "uint64", "address", "uint256"],
    [CHAIN_ID, HEX_U64, to, MINT_COST],
    sig
  );
  assert.equal(recovered, SIGNER);
});

test("signChallengeDeclaration verifies for ZoneChallenge.declareChallenge (chainId,hexId,defender,baseScore)", async () => {
  const defender = to;
  const baseScore = 1234n;
  const sig = await oracle.signChallengeDeclaration(HEX, defender, baseScore);
  const recovered = recoverPacked(
    ["uint256", "uint64", "address", "uint256"],
    [CHAIN_ID, HEX_U64, defender, baseScore],
    sig
  );
  assert.equal(recovered, SIGNER);
});

test("signScore verifies for ZoneChallenge.submitScore (chainId,hexId,submitter,score)", async () => {
  const score = 4200n;
  const sig = await oracle.signScore(HEX, submitter, score);
  const recovered = recoverPacked(
    ["uint256", "uint64", "address", "uint256"],
    [CHAIN_ID, HEX_U64, submitter, score],
    sig
  );
  assert.equal(recovered, SIGNER);
});

test("signGreatBurn verifies for SeasonController.greatBurn (abi.encode(chainId,season,hexIds,yields))", async () => {
  const season = 3n;
  const hexIds = [HEX_U64, HEX_U64 + 1n];
  const yields = [10n ** 18n, 2n * 10n ** 18n];
  const sig = await oracle.signGreatBurn(season, hexIds, yields);

  // Contract uses non-packed abi.encode — mirror with AbiCoder, NOT solidityPacked.
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint64[]", "uint256[]"],
    [CHAIN_ID, season, hexIds, yields]
  );
  const digest = ethers.keccak256(payload);
  assert.equal(ethers.verifyMessage(ethers.getBytes(digest), sig), SIGNER);
});

test("NEGATIVE: the old route tuple (address,routeHash,distance — no chainId/hexId) does not verify", async () => {
  const sig = await oracle.signRouteProof(to, routeHash, 20_000, HEX_U64);
  const recovered = recoverPacked(
    ["address", "bytes32", "uint256"],
    [to, routeHash, 20_000n],
    sig
  );
  assert.notEqual(recovered, SIGNER);
});

test("NEGATIVE: a wrong chainId does not verify (chainId binding is enforced)", async () => {
  const sig = await oracle.signRouteProof(to, routeHash, 20_000, HEX_U64);
  const recovered = recoverPacked(
    ["uint256", "address", "bytes32", "uint256", "uint64"],
    [1n, to, routeHash, 20_000n, HEX_U64], // wrong chainId (mainnet)
    sig
  );
  assert.notEqual(recovered, SIGNER);
});

test("NEGATIVE: a wrong hexId does not verify for a route proof", async () => {
  const sig = await oracle.signRouteProof(to, routeHash, 20_000, HEX_U64);
  const recovered = recoverPacked(
    ["uint256", "address", "bytes32", "uint256", "uint64"],
    [CHAIN_ID, to, routeHash, 20_000n, HEX_U64 + 1n], // wrong hexId
    sig
  );
  assert.notEqual(recovered, SIGNER);
});

test("GUARD: signChallengeDeclaration refuses a zero/invalid defender address", async () => {
  await assert.rejects(
    () => oracle.signChallengeDeclaration(HEX, ZERO, 100n),
    /zero\/invalid defender/
  );
});

test("GUARD: signChallengeDeclaration refuses a zero defenderBaseScore", async () => {
  await assert.rejects(
    () => oracle.signChallengeDeclaration(HEX, to, 0n),
    /zero defenderBaseScore/
  );
});

test("GUARD: allowUnvalidated bypass (tests only) still signs the correct tuple", async () => {
  const sig = await oracle.signChallengeDeclaration(HEX, ZERO, 0n, { allowUnvalidated: true });
  const recovered = recoverPacked(
    ["uint256", "uint64", "address", "uint256"],
    [CHAIN_ID, HEX_U64, ZERO, 0n],
    sig
  );
  assert.equal(recovered, SIGNER);
});

test("chainId is bound from the constructor (Base Sepolia 84532)", () => {
  assert.equal(oracle.chainId, CHAIN_ID);
});
