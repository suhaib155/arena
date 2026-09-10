/**
 * Constructor arguments for MovenRunTimelock, exactly as recorded in the deployment manifest.
 *
 * Usage:
 *   npx hardhat verify --network baseSepolia \
 *     --constructor-args scripts/v3/verification/MovenRunTimelock.args.js \
 *     <MovenRunTimelock address>
 */
const { constructorArgumentsFor } = require("./manifest");

module.exports = constructorArgumentsFor("MovenRunTimelock");
