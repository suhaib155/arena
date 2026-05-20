"use strict";

/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // Strip .js from relative imports (Node ESM pattern)
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Map @movenrun/shared deep imports (with or without .js extension)
    "^@movenrun/shared/src/(.*?)(?:\\.js)?$": "<rootDir>/../shared/src/$1",
    // Map bare @movenrun/shared to its index
    "^@movenrun/shared$": "<rootDir>/../shared/src/index.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        isolatedModules: true,
        tsconfig: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          isolatedModules: true,
        },
      },
    ],
  },
  testMatch: ["**/src/__tests__/**/*.test.ts"],
  collectCoverageFrom: ["src/services/**/*.ts"],
};
