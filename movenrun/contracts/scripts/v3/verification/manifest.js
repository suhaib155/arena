/**
 * Shared loader for the MovenRun V3 deployment manifest.
 *
 * The constructor-argument modules in this directory read the arguments that were actually
 * recorded when each contract was deployed, so verification can never drift from the
 * deployed bytecode.
 */
const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(__dirname, "..", "..", "..", "deployments", "v3", "base-sepolia.json");

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      `MovenRun V3 deployment manifest not found at ${MANIFEST_PATH}. ` +
        "Deploy first with scripts/v3/deployBaseSepolia.ts, or restore the manifest recorded " +
        "for the deployment you are verifying."
    );
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

/** Constructor arguments recorded for a deployed contract. */
function constructorArgumentsFor(contractName) {
  const manifest = loadManifest();
  const record = manifest.contracts && manifest.contracts[contractName];
  if (!record) {
    throw new Error(`Manifest holds no record for ${contractName}`);
  }
  if (!Array.isArray(record.constructorArguments)) {
    throw new Error(`Manifest record for ${contractName} has no constructorArguments array`);
  }
  return record.constructorArguments;
}

/** Deployed address recorded for a contract. */
function addressFor(contractName) {
  const manifest = loadManifest();
  const record = manifest.contracts && manifest.contracts[contractName];
  if (!record) {
    throw new Error(`Manifest holds no record for ${contractName}`);
  }
  return record.address;
}

module.exports = { loadManifest, constructorArgumentsFor, addressFor, MANIFEST_PATH };
