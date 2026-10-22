"""Harness-only port of the pinned branch fixture to the patched ABIs (scratch copy only).
Usage: python3 port-shim.py <path to scratch test/v3/helpers.ts>
Changes: deploySuite also registers a second eligibility signer, a city-region root and city-wide
caps through the real timelock; claimDeed signs a threshold attestation and waits out the 7-day
pending window after a successful claim. submitScore is deliberately NOT ported: single-sided
scoring was removed by the patch, which is a contract change, not a harness assumption."""
import sys
p = sys.argv[1]
s = open(p).read()
assert "export async function deploySuite(): Promise<Suite> {" in s
s = s.replace("export async function deploySuite(): Promise<Suite> {", "async function deploySuiteBase(): Promise<Suite> {", 1)
assert "export async function claimDeed(" in s
s = s.replace("export async function claimDeed(", "export async function claimDeedSingleSigner(", 1)
s += r'''

// ---- port shim (scratch copy only) ----
import { cellToParent as __c2p } from "h3-js";
import { cityCells as __cityCells, cellAt as __cellAt } from "./cells";

const __CITIES = [1, 2, 7, 9];
const __parentOf = (cell: bigint) => BigInt("0x" + __c2p(cell.toString(16), 5));
const __leaf = (parent: bigint, cityId: number) =>
  ethers.keccak256(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint64", "uint32"], [parent, cityId])));
const __pair = (a: string, b: string) => (BigInt(a) <= BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a])));
function __tree() {
  const parents = [...new Set([...__cityCells(40), __cellAt(12.9716, 77.5946)].map((c) => __parentOf(c).toString()))].map(BigInt);
  const leaves: string[] = [];
  for (const c of __CITIES) for (const p of parents) leaves.push(__leaf(p, c));
  const layers: string[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const nxt: string[] = [];
    for (let i = 0; i < cur.length; i += 2) nxt.push(i + 1 < cur.length ? __pair(cur[i], cur[i + 1]) : cur[i]);
    layers.push(nxt);
  }
  const proofFor = (parent: bigint, cityId: number) => {
    let idx = leaves.indexOf(__leaf(parent, cityId));
    const proof: string[] = [];
    if (idx < 0) return proof;
    for (let l = 0; l < layers.length - 1; l++) {
      const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (sib < layers[l].length) proof.push(layers[l][sib]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  };
  return { root: layers[layers.length - 1][0], proofFor };
}

export async function deploySuite(): Promise<Suite> {
  const f: any = await deploySuiteBase();
  const signers = await ethers.getSigners();
  f.eligibilityCoSigner = signers[11];
  f.contestCoSigner = signers[12];
  f.tree = __tree();
  const run = (target: string, iface: any, fn: string, args: any[], salt: string) =>
    execViaTimelock(f, target, iface.encodeFunctionData(fn, args), ethers.id(salt));
  await run(f.addresses.deedClaims, f.deedClaims.interface, "setEligibilitySignerRegistered", [f.eligibilityCoSigner.address, true], "p-co");
  await run(f.addresses.deedClaims, f.deedClaims.interface, "setCityRegionRoot", [f.tree.root], "p-root");
  for (const c of __CITIES) await run(f.addresses.deedClaims, f.deedClaims.interface, "setCityWideCap", [c, 50], "p-cap-" + c);
  await run(f.addresses.contests, f.contests.interface, "setContestCoSigner", [f.contestCoSigner.address], "p-cco");
  return f as Suite;
}

const __V2 = {
  DeedEligibilityAttestation: [
    { name: "claimant", type: "address" }, { name: "h3CellId", type: "uint64" }, { name: "cityId", type: "uint32" },
    { name: "solidGround", type: "bool" }, { name: "tenureDays", type: "uint32" }, { name: "distinctCrossers", type: "uint32" },
    { name: "trafficDays", type: "uint32" }, { name: "relatedTrafficExcluded", type: "bool" },
    { name: "clusterId", type: "bytes32" }, { name: "evidenceHash", type: "bytes32" }, { name: "claimFee", type: "uint256" },
    { name: "rulesVersion", type: "uint16" }, { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint64" },
  ],
};

export async function claimDeed(fx: Suite, claimant: HardhatEthersSigner, h3CellId: bigint, cityId: number, overrides: Partial<EligibilityAttestation> = {}) {
  const base = await eligibilityAttestation({ claimant: claimant.address, h3CellId, cityId, ...overrides });
  const att = { ...base, clusterId: ethers.id("cluster:" + claimant.address), evidenceHash: ethers.id("evidence:" + h3CellId) };
  const f: any = fx;
  const dom = domain("MovenRunDeedClaims", fx.chainId, fx.addresses.deedClaims);
  const two = [fx.deedSigner, f.eligibilityCoSigner].sort((a: any, b: any) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  const sigs = await Promise.all(two.map((x: any) => x.signTypedData(dom, __V2, att)));
  const call = fx.deedClaims.connect(claimant).claimWithThreshold(att, sigs, f.tree.proofFor(__parentOf(h3CellId), cityId), att.claimFee);
  return call.then(async (tx: any) => { await tx.wait(); await time.increase(7 * 86400 + 1); return tx; });
}
'''
open(p, 'w').write(s)
