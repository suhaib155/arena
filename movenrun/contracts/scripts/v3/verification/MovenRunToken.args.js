/**
 * Constructor arguments for MovenRunToken, exactly as recorded in the deployment manifest.
 *
 * Usage:
 *   npx hardhat verify --network baseSepolia \
 *     --constructor-args scripts/v3/verification/MovenRunToken.args.js \
 *     <MovenRunToken address>
 */
const { constructorArgumentsFor } = require("./manifest");

module.exports = constructorArgumentsFor("MovenRunToken");
