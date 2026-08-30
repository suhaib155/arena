/**
 * DeedRegistry deployment — fail closed, on purpose.
 *
 * The old generic mainnet script was removed (PR #49) because it would deploy
 * to whichever RPC happened to be configured. This one refuses to do anything
 * until it has checked, against the live chain, that it is where it was told to
 * be — and refuses to configure the registry unsafely even then.
 *
 * Usage:
 *   DEED_TARGET=baseSepolia npx hardhat run scripts/deploy/deedRegistry.ts --network baseSepolia
 *   DEED_TARGET=base        npx hardhat run scripts/deploy/deedRegistry.ts --network base
 *
 * Required environment:
 *   DEED_TARGET          "baseSepolia" | "base" — the chain you intend
 *   DEED_ADMIN           registry administrator (a Safe on mainnet)
 *   DEED_ORACLE_SIGNER   the claim-signing key's ADDRESS (never its key)
 *   DEED_BASE_URI        metadata base URI (may be set later instead)
 *
 * No private key is read, printed, or logged by this script. The deployer key
 * reaches Hardhat through its own config; nothing here touches it.
 */
import { ethers, network, run } from "hardhat";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const CHAINS: Record<string, { chainId: bigint; label: string; explorer: string }> = {
  baseSepolia: { chainId: 84532n, label: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
  base: { chainId: 8453n, label: "Base mainnet", explorer: "https://basescan.org" },
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required. Refusing to deploy with an incomplete configuration.`);
  }
  return value.trim();
}

async function main() {
  const target = required("DEED_TARGET");
  const expected = CHAINS[target];
  if (!expected) {
    throw new Error(
      `DEED_TARGET must be one of ${Object.keys(CHAINS).join(", ")} — got "${target}".`,
    );
  }

  /* The gate. Read from the node itself rather than from the config, because
     the config is exactly the thing that might be wrong: a stale --network
     flag, an RPC URL pointing somewhere else, a copied .env. If the chain the
     RPC reports is not the chain that was asked for, stop. */
  const live = await ethers.provider.getNetwork();
  if (live.chainId !== expected.chainId) {
    throw new Error(
      `Refusing to deploy. DEED_TARGET=${target} expects chainId ${expected.chainId} ` +
        `(${expected.label}), but the configured RPC reports chainId ${live.chainId}. ` +
        "Check --network and your RPC URL.",
    );
  }

  const admin = ethers.getAddress(required("DEED_ADMIN"));
  const oracleSigner = ethers.getAddress(required("DEED_ORACLE_SIGNER"));
  const baseURI = process.env.DEED_BASE_URI?.trim() ?? "";

  /* The contract enforces this too. Checking here as well means the mistake is
     caught before a transaction is paid for, with a message that says why. */
  if (admin.toLowerCase() === oracleSigner.toLowerCase()) {
    throw new Error(
      "DEED_ADMIN and DEED_ORACLE_SIGNER must be different addresses. The oracle key is " +
        "online and signs routinely; it must not also administer the registry.",
    );
  }

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  if (deployerAddress.toLowerCase() === oracleSigner.toLowerCase()) {
    throw new Error("The deploying key must not also be the oracle signer.");
  }

  const isMainnet = expected.chainId === 8453n;
  if (isMainnet) {
    /* Mainnet-only requirements. The registry is permanent and the admin can
       never be recovered if it is wrong, so an unset base URI or an EOA-looking
       admin is worth stopping for. */
    if (baseURI === "") {
      throw new Error("DEED_BASE_URI must be set for a mainnet deployment.");
    }
    if (admin.toLowerCase() === deployerAddress.toLowerCase()) {
      throw new Error(
        "On mainnet the administrator must not be the deploying EOA. Use the Safe address.",
      );
    }
    const adminCode = await ethers.provider.getCode(admin);
    if (adminCode === "0x") {
      throw new Error(
        `DEED_ADMIN ${admin} has no contract code on ${expected.label}. A Safe multisig is ` +
          "expected. Set DEED_ALLOW_EOA_ADMIN=1 only if an EOA administrator is a deliberate, " +
          "reviewed decision.",
      );
    }
  }

  console.log(`Network      : ${expected.label} (chainId ${live.chainId})`);
  console.log(`Deployer     : ${deployerAddress}`);
  console.log(`Admin        : ${admin}`);
  console.log(`Oracle signer: ${oracleSigner}`);
  console.log(`Base URI     : ${baseURI === "" ? "(unset — set with setBaseURI)" : baseURI}`);

  const Registry = await ethers.getContractFactory("DeedRegistry");
  const registry = await Registry.deploy(admin, oracleSigner, baseURI);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();
  console.log(`\nDeedRegistry : ${address}`);
  console.log(`Tx           : ${deployTx?.hash}`);
  console.log(`Explorer     : ${expected.explorer}/address/${address}`);

  /* Post-deploy assertions. A deployment that succeeded but configured the
     wrong roles is worse than one that failed, because it looks fine. */
  const ADMIN_ROLE = await registry.DEFAULT_ADMIN_ROLE();
  const ORACLE_ROLE = await registry.ORACLE_SIGNER_ROLE();
  const checks: [string, boolean][] = [
    ["admin holds DEFAULT_ADMIN_ROLE", await registry.hasRole(ADMIN_ROLE, admin)],
    ["oracle holds ORACLE_SIGNER_ROLE", await registry.hasRole(ORACLE_ROLE, oracleSigner)],
    ["admin is NOT an oracle signer", !(await registry.hasRole(ORACLE_ROLE, admin))],
    ["oracle is NOT an administrator", !(await registry.hasRole(ADMIN_ROLE, oracleSigner))],
    ["deployer holds no admin role", !(await registry.hasRole(ADMIN_ROLE, deployerAddress))],
    ["deployer holds no oracle role", !(await registry.hasRole(ORACLE_ROLE, deployerAddress))],
    ["totalSupply is readable and zero", (await registry.totalSupply()) === 0n],
    ["claims are not paused", (await registry.claimsPaused()) === false],
  ];
  console.log("");
  let failed = false;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`);
    if (!ok) failed = true;
  }
  if (failed) {
    throw new Error("Post-deploy verification failed. Do not use this deployment.");
  }

  const dir = join(__dirname, "..", "..", "deployments");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `deedRegistry.${target}.json`);
  const record = {
    contract: "DeedRegistry",
    network: target,
    chainId: Number(live.chainId),
    address,
    deploymentTx: deployTx?.hash ?? null,
    // Public addresses only. No key material of any kind is recorded here.
    constructorArgs: { admin, oracleSigner, baseURI },
    deployedAt: new Date().toISOString(),
    sourceVerified: false,
  };
  // Never clobber an existing record — a second deployment to the same chain is
  // a mistake worth noticing rather than silently overwriting.
  if (existsSync(file)) {
    const previous = JSON.parse(readFileSync(file, "utf8"));
    throw new Error(
      `${file} already records a ${target} deployment at ${previous.address}. ` +
        "Remove or rename it deliberately before deploying again.",
    );
  }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nRecorded: ${file}`);

  console.log(
    `\nVerify with:\n  npx hardhat verify --network ${network.name} ${address} ` +
      `${admin} ${oracleSigner} "${baseURI}"`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
