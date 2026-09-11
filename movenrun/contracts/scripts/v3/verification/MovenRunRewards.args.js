/**
 * Constructor arguments for MovenRunRewards, exactly as recorded in the deployment manifest.
 *
 * Usage:
 *   npx hardhat verify --network baseSepolia \
 *     --constructor-args scripts/v3/verification/MovenRunRewards.args.js \
 *     <MovenRunRewards address>
 */
const { constructorArgumentsFor } = require("./manifest");

module.exports = constructorArgumentsFor("MovenRunRewards");
