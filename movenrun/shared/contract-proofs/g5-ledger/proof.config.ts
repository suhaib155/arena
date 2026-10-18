import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import * as path from "path";

// Use the solcjs build already in node_modules so nothing is downloaded.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async () => {
  const solcPkg = require.resolve("solc/package.json");
  const version: string = require(solcPkg).version;
  return {
    compilerPath: path.join(path.dirname(solcPkg), "soljson.js"),
    isSolcJs: true,
    version,
    longVersion: version,
  };
});

const config: HardhatUserConfig = {
  solidity: {
    version: require("solc/package.json").version,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: { hardhat: { chainId: 31337 } },
  paths: { sources: "./src/v3", tests: "./test/ledger", cache: "./cache-ledger", artifacts: "./artifacts-ledger" },
  typechain: { dontOverrideCompile: true } as any,
};
export default config;
