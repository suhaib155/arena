require("@nomicfoundation/hardhat-toolbox");

// Force Hardhat to use the bundled WASM (soljson.js) compiler on this
// network-restricted environment instead of downloading a native binary.
const { CompilerDownloader } = require("hardhat/internal/solidity/compiler/downloader");
CompilerDownloader.getCompilerPlatform = () => "wasm";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
  },
};
