// The harness scripts must be offline-only: no network tool, no env file read, no RPC-capable config.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

test("reverify.sh and port-shim.py contain no network client, no env-file read and no download step", () => {
  for (const f of ["reverify.sh", "port-shim.py"]) {
    const t = read(f).split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    assert.doesNotMatch(t, /\b(curl|wget|ssh|scp|nc|ncat|socat)\b/, f);
    assert.doesNotMatch(t, /https?:\/\//, f);
    assert.doesNotMatch(t.replace(/process\\\.env/g, ""), /\.env\b|dotenv/, f);
    assert.doesNotMatch(t, /\b(npm|yarn|pnpm|pip)\s+(install|add|i)\b/, f);
    assert.doesNotMatch(t, /\burllib|\bsocket\b|\brequests\b/, f);
  }
});

test("reverify.sh refuses to run when an RPC or key variable is set, and checks the proof config has no url/accounts", () => {
  const t = read("reverify.sh");
  assert.match(t, /BASE_SEPOLIA_RPC_URL/);
  assert.match(t, /url:\|accounts:\|process\\\.env/);
});

test("vendored hardhat config targets only the in-process network", () => {
  const c = read("vendored-122/proof.config.ts");
  assert.match(c, /networks: \{ hardhat: \{ chainId: 31337 \} \}/);
  assert.doesNotMatch(c, /url:|accounts:|process\.env|dotenv/);
});

test("no Solidity file exists under research/economy-redteam outside the two vendored folders", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const root = join(here, "..");
  const bad: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".sol") && !/[\\/]contracts[\\/]vendored-(122|c8262ec)[\\/]/.test(p)) bad.push(p);
    }
  };
  walk(root);
  assert.deepEqual(bad, []);
});

test("reverify.sh uses the local hardhat binary and the widened env guard", () => {
  const t = read("reverify.sh");
  assert.match(t, /node_modules\/\.bin\/hardhat/);
  assert.doesNotMatch(t, /npx /);
  assert.match(t, /MNEMONIC/);
  assert.match(t, /_PRIVATE_KEY/);
});
