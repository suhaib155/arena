// Static assertions over Solidity text. They read the vendored prototype sources (c8262ec), the vendored
// draft patches from the contract-proof line, and the V1 sources in this checkout. Nothing is compiled
// and no chain is touched. Each test states the invariant and the evidence tier in its name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const orig = (n: string) => strip(read(`vendored-c8262ec/${n}.sol`));
const patched = (n: string) => strip(read(`vendored-122/patched/${n}.sol`));
const v1 = (n: string) => strip(readFileSync(join(here, "../../../contracts/src", `${n}.sol`), "utf8"));

function body(src: string, fn: string): string {
  const i = src.search(new RegExp(`function\\s+${fn}\\s*\\(`));
  assert.ok(i >= 0, `function ${fn} not found`);
  let depth = 0, started = false;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") { depth++; started = true; }
    if (src[j] === "}") depth--;
    if (started && depth === 0) return src.slice(i, j + 1);
  }
  throw new Error("unbalanced");
}

test("vendored files match their recorded SHA-256 sums (inputs were not edited)", () => {
  for (const dir of ["vendored-122", "vendored-c8262ec"]) {
    const lines = read(`${dir}/SHA256SUMS`).trim().split("\n");
    for (const l of lines) {
      const [sum, file] = l.split(/\s+/);
      assert.equal(createHash("sha256").update(readFileSync(join(here, dir, file!))).digest("hex"), sum, `${dir}/${file}`);
    }
  }
});

/* --- mint / burn / cap (V3 section 22, rule 2) --- */
test("VERIFIED CODE: V3 token burns with _burn, never by moving value to a treasury", () => {
  const t = orig("MovenRunToken");
  assert.match(body(t, "_burnLockedFirst"), /_burn\(account, amount\)/);
  assert.match(body(t, "settlementIssue"), /_burn\(reserve, burnAmount\)/);
  assert.doesNotMatch(t, /treasury/i);
  assert.doesNotMatch(t, /transfer\([^)]*treasury/i);
});

test("VERIFIED CODE: V3 cap is checked against cumulativeMinted, which no burn path decrements", () => {
  const t = orig("MovenRunToken");
  assert.match(body(t, "settlementIssue"), /MAX_LIFETIME_MINTED - cumulativeMinted/);
  const writes = t.match(/cumulativeMinted\s*(\+=|-=|=(?!=))/g) ?? [];
  assert.deepEqual(writes, ["cumulativeMinted +="]);
  assert.match(t, /MAX_LIFETIME_MINTED = 1_000_000_000 ether/);
});

test("VERIFIED CODE: only the settlement contract can mint; there is no other _mint call site", () => {
  const t = orig("MovenRunToken");
  assert.equal((t.match(/_mint\(/g) ?? []).length, 1);
  assert.match(body(t, "settlementIssue"), /msg\.sender != settlement/);
});

test("documents defect: V1 SeasonController.greatBurn is a transfer to the DAO treasury, not a burn (V3 section 22, discrepancy 8)", () => {
  const b = body(v1("SeasonController"), "greatBurn");
  assert.match(b, /transferFrom\(owner, daoTreasury, burnAmount\)/);
  assert.doesNotMatch(b, /_burn\(|burnFrom\(|burnMOVE\(/);
});

test("documents defect: V1 greatBurn has no per-season finalized flag or used-payload record (replay, discrepancy 9)", () => {
  const sc = v1("SeasonController");
  assert.doesNotMatch(sc, /mapping\s*\([^)]*\)\s*(public\s+)?\w*(used|executed|finalized|burned)\w*/i);
  assert.doesNotMatch(body(sc, "greatBurn"), /require\(!\w+\[/);
});

test("documents defect: V1 MoveToken checks the cap against totalSupply(), so a real burn reopens issuance (V3 rule 2 and section 22)", () => {
  const t = v1("MoveToken");
  assert.match(t, /totalSupply\(\) \+ earned <= MAX_SUPPLY/);
  assert.doesNotMatch(t, /cumulative|everMinted/i);
});

/* --- approvals / allowances --- */
test("VERIFIED CODE: burnFrom needs FEE_BURNER_ROLE and spends the holder's allowance first", () => {
  const b = body(orig("MovenRunToken"), "burnFrom");
  assert.match(b, /onlyRole\(FEE_BURNER_ROLE\)/);
  assert.ok(b.indexOf("_spendAllowance") < b.indexOf("_burnLockedFirst"));
});

test("VERIFIED CODE: FEE_BURNER_ROLE is granted only in the constructor, administered by DEFAULT_ADMIN_ROLE (timelock): a grant is a timelocked operation", () => {
  const t = orig("MovenRunToken");
  const grants = t.match(/_grantRole\(FEE_BURNER_ROLE[^)]*\)/g) ?? [];
  assert.equal(grants.length, 1);
  assert.doesNotMatch(t, /_setRoleAdmin/);
  assert.match(t, /ERC20Permit/); // approvals can be granted by signature; wallets must show spender and amount
});

test("VERIFIED CODE: the marketplace relies on a standing setApprovalForAll and compares only the current owner on buy (M6)", () => {
  const m = orig("MovenRunMarketplace");
  const buy = body(m, "buy");
  assert.match(buy, /ownerOf\(/);
  assert.doesNotMatch(buy, /transferCount|nonce|epoch/i);
});

/* --- single signer / oracle concentration --- */
test("VERIFIED CODE: prototype deed claims accept one eligibility signature; the draft patch disables it", () => {
  const o = body(orig("MovenRunDeedClaims"), "claim");
  assert.equal((o.match(/ECDSA\.recover\(/g) ?? []).length, 1);
  assert.match(body(patched("MovenRunDeedClaims"), "claim"), /SingleSignerClaimsDisabled/);
  assert.match(patched("MovenRunDeedClaims"), /MIN_ATTESTATION_THRESHOLD = 2/);
});

test("VERIFIED CODE: prototype contest scores accept one signer; the draft patch needs two distinct keys for both sides of a day", () => {
  assert.equal((body(orig("MovenRunContests"), "submitScore").match(/ECDSA\.recover\(/g) ?? []).length, 1);
  const p = patched("MovenRunContests");
  assert.match(body(p, "submitScore"), /SingleSidedScoresDisabled/);
  assert.match(body(p, "submitDayScores"), /coSigner|coSignature/);
});

test("documents defect: draft patch leaves declarations single-signed (H2b) and the rules version unsnapshotted (M3)", () => {
  const p = patched("MovenRunContests");
  const d = body(p, "declareContest");
  assert.equal((d.match(/ECDSA\.recover\(/g) ?? []).length, 1);
  assert.doesNotMatch(p, /struct Contest \{[^}]*rulesVersion/);
});

test("VERIFIED CODE: settlement requires two distinct keys (both prototype and patch)", () => {
  for (const s of [orig("MovenRunSettlement"), patched("MovenRunSettlement")]) {
    const b = body(s, "publishSettlement");
    assert.match(b, /settlementSigner/);
    assert.match(b, /reconciliationSigner/);
  }
});

test("documents defect: V1 has a single oracle operator and a single admin; there is no timelock contract in V1", () => {
  const g = v1("GPSOracle");
  assert.match(g, /oracleOperator/);
  const files = ["MoveToken", "GPSOracle", "ZoneNFT", "GearNFT", "MoveVault", "ZoneChallenge", "SeasonController", "MovenDAO"].map(v1).join("\n");
  assert.doesNotMatch(files, /TimelockController/);
});

/* --- timelock --- */
test("documents defect: timelock constructor refuses only a zero delay; no floor, and updateDelay is not overridden (L2)", () => {
  const t = orig("MovenRunTimelock");
  assert.match(t, /minDelay == 0/);
  assert.doesNotMatch(t, /MIN_DELAY_FLOOR|updateDelay/);
});

/* --- H1 / H2 / H3 / N1 status in the draft patches --- */
test("H1 fixed in draft: day id is bound to the clock, a per-publication ceiling exists, authorisation lifetime is bounded", () => {
  const s = patched("MovenRunSettlement");
  const b = body(s, "publishSettlement");
  assert.match(b, /DayNotYetClosed/);
  assert.match(b, /PublicationAboveDailyCeiling/);
  assert.match(b, /AuthorizationLifetimeTooLong/);
  assert.match(s, /uint64 public immutable genesis/);
});

test("H1 present in prototype: no clock reference in publishSettlement", () => {
  assert.doesNotMatch(body(orig("MovenRunSettlement"), "publishSettlement").replace(/block\.timestamp > authorization\.expiry/, ""), /genesis|SETTLEMENT_DAY|closesAt/);
});

test("N1 fixed in draft: pending window and void exist; after the window the only exit is holder relinquish", () => {
  const d = patched("MovenRunDeed");
  assert.match(body(d, "voidPendingDeed"), /onlyRole\(VOIDER_ROLE\)/);
  assert.match(body(d, "voidPendingDeed"), /DeedAlreadyFinal|isFinal|pending/i);
  assert.match(body(d, "relinquish"), /ownerOf\(tokenId\)|msg\.sender/);
  assert.doesNotMatch(orig("MovenRunDeed"), /function (burn|revoke|void|relinquish)\w*\(/);
});

test("documents defect (M8, V3 rules 12 and 27): the deed token id is still the public H3 cell id in the draft patch", () => {
  assert.match(patched("MovenRunDeed"), /tokenId = uint256\(h3CellId\)/);
  assert.match(orig("MovenRunDeed"), /tokenId = uint256\(h3CellId\)/);
});

test("documents defect (M4): toll credits are added to the liquid bucket without touching the allowance, in prototype and in the patch", () => {
  for (const s of [orig("MovenRunSettlement"), patched("MovenRunSettlement")]) {
    assert.match(s, /authorization\.liquidMovementClaims \+ authorization\.tollCredits/);
    assert.match(s, /liquidIssuanceAllowance -= authorization\.liquidMovementClaims/);
  }
});

test("documents defect (M7): deed claim fee burns locked balance first and the deed stays a plain ERC-721", () => {
  assert.match(body(orig("MovenRunToken"), "_burnLockedFirst"), /_lockedBalances\[account\]/);
  assert.match(orig("MovenRunDeed"), /is ERC721/);
  assert.doesNotMatch(orig("MovenRunDeed"), /soulbound|nonTransferable/i);
});

/* --- replay / domain separation --- */
test("VERIFIED CODE: every V3 signed contract is an EIP-712 domain with its own name; reward leaves hash block.chainid", () => {
  const names = ["MovenRunSettlement", "MovenRunDeedClaims", "MovenRunContests"].map((n) => orig(n).match(/EIP712\("([^"]+)", "([^"]+)"\)/)!.slice(1, 3).join("@"));
  assert.deepEqual(names, ["MovenRunSettlement@3", "MovenRunDeedClaims@3", "MovenRunContests@3"]);
  assert.match(orig("MovenRunRewards"), /block\.chainid/);
  assert.match(orig("MovenRunRegistry"), /ChainIdMismatch/);
});

test("documents defect: the draft patch changes the claim and score type hashes but keeps domain version 3 (needs a bump before any release)", () => {
  assert.match(patched("MovenRunDeedClaims"), /EIP712\("MovenRunDeedClaims", "3"\)/);
  assert.match(patched("MovenRunContests"), /EIP712\("MovenRunContests", "3"\)/);
});

test("VERIFIED CODE: V1 oracle-signed payloads include block.chainid (FIX-001) but use no EIP-712 domain with a verifying contract", () => {
  for (const f of ["GPSOracle", "ZoneChallenge"]) assert.match(v1(f), /block\.chainid/);
  assert.doesNotMatch(v1("GPSOracle"), /EIP712|verifyingContract/);
});

/* --- upgrades / asset loss --- */
test("VERIFIED CODE: no proxy, delegatecall, selfdestruct or upgrade function in V3 or V1 sources", () => {
  const all = [
    ...["Token", "Rewards", "Settlement", "Deed", "DeedClaims", "Contests", "Marketplace", "Registry", "Timelock"].map((n) => orig(`MovenRun${n}`)),
    ...["MoveToken", "GPSOracle", "ZoneNFT", "GearNFT", "MoveVault", "ZoneChallenge", "SeasonController", "MovenDAO"].map(v1),
  ].join("\n");
  assert.doesNotMatch(all, /delegatecall|selfdestruct|UUPS|TransparentUpgradeable|upgradeTo|Initializable/);
});

test("VERIFIED CODE: the V3 token wiring is one-time; no setter replaces settlement or rewards after finalisation", () => {
  const t = orig("MovenRunToken");
  assert.match(body(t, "configureCore"), /BootstrapIsFrozen|BootstrapAlreadyConfigured/);
  assert.equal((t.match(/settlement\s*=\s*settlement_/g) ?? []).length, 1);
});

test("documents gap: neither V3 nor V1 contains a migration or export path for deeds or balances to a successor contract", () => {
  const all = ["MovenRunDeed", "MovenRunToken", "MovenRunRewards"].map(orig).join("\n");
  assert.doesNotMatch(all, /migrate|successor|export/i);
});

/* --- pause must not trap value --- */
test("VERIFIED CODE: rewards claim has no pause and no admin role", () => {
  const r = orig("MovenRunRewards");
  assert.doesNotMatch(r, /Pausable|whenNotPaused|AccessControl|onlyRole/);
});
