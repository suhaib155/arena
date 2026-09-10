/**
 * Constructor arguments for MovenRunDeedClaims, exactly as recorded in the deployment manifest.
 *
 * Usage:
 *   npx hardhat verify --network baseSepolia \
 *     --constructor-args scripts/v3/verification/MovenRunDeedClaims.args.js \
 *     <MovenRunDeedClaims address>
 */
const { constructorArgumentsFor } = require("./manifest");

module.exports = constructorArgumentsFor("MovenRunDeedClaims");
