/**
 * Constructor arguments for MovenRunMarketplace, exactly as recorded in the deployment manifest.
 *
 * Usage:
 *   npx hardhat verify --network baseSepolia \
 *     --constructor-args scripts/v3/verification/MovenRunMarketplace.args.js \
 *     <MovenRunMarketplace address>
 */
const { constructorArgumentsFor } = require("./manifest");

module.exports = constructorArgumentsFor("MovenRunMarketplace");
