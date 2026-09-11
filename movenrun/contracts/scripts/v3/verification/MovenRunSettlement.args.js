/**
 * Constructor arguments for MovenRunSettlement, exactly as recorded in the deployment manifest.
 *
 * Usage:
 *   npx hardhat verify --network baseSepolia \
 *     --constructor-args scripts/v3/verification/MovenRunSettlement.args.js \
 *     <MovenRunSettlement address>
 */
const { constructorArgumentsFor } = require("./manifest");

module.exports = constructorArgumentsFor("MovenRunSettlement");
