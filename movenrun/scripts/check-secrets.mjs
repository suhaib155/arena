#!/usr/bin/env node
// Fails when a server secret appears where it must never be: tracked files,
// git history (--history), or a built bundle or folder passed as an argument
// (for example the app's Hermes export or the website).
//
//   node scripts/check-secrets.mjs                 tracked files at HEAD
//   node scripts/check-secrets.mjs --history       every commit on every branch
//   node scripts/check-secrets.mjs dist/ website/  these files or folders
//
// Only the kind of secret and its location are printed, never the value.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PATTERNS = [
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}/g],
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g],
  ["Resend API key", /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{16,}/g],
  ["GitHub token", /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}/g],
  ["Google OAuth client secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["hex private key assignment", /PRIVATE_KEY\s*[:=]\s*["']?(?:0x)?[0-9a-fA-F]{64}\b/g],
  ["Expo access token", /EXPO_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/g],
];

// Well-known public test keys (Hardhat/Anvil default accounts) are not secrets.
const PUBLIC_TEST_KEYS = new Set([
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
]);

/** JWTs whose payload says role service_role: the legacy Supabase secret key. */
function serviceRoleJwts(text) {
  const found = [];
  for (const m of text.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (payload && payload.role === "service_role") found.push(m.index);
    } catch {
      // not a JWT payload
    }
  }
  return found;
}

function scan(text, where, hits) {
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const hex = /[0-9a-fA-F]{64}/.exec(m[0]);
      if (kind === "hex private key assignment" && hex && PUBLIC_TEST_KEYS.has(hex[0].toLowerCase())) continue;
      hits.push(`${where}: ${kind}`);
    }
  }
  for (const _ of serviceRoleJwts(text)) hits.push(`${where}: Supabase service_role JWT`);
}

function walk(path, out) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (name === "node_modules" || name === ".git") continue;
      walk(join(path, name), out);
    }
  } else if (st.size < 20 * 1024 * 1024) {
    out.push(path);
  }
}

const args = process.argv.slice(2);
const hits = [];
if (args.includes("--history")) {
  const log = execFileSync("git", ["log", "--all", "-p", "--no-color", "--format=commit %H"], { maxBuffer: 1024 * 1024 * 1024 }).toString("utf8");
  let commit = "?";
  for (const chunk of log.split(/^(?=commit [0-9a-f]{40}$)/m)) {
    const head = /^commit ([0-9a-f]{40})$/m.exec(chunk);
    if (head) commit = head[1].slice(0, 7);
    // Only added lines can introduce a secret.
    const added = chunk.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
    scan(added, `commit ${commit}`, hits);
  }
} else if (args.length > 0) {
  const files = [];
  for (const a of args) walk(a, files);
  for (const f of files) scan(readFileSync(f).toString("utf8"), f, hits);
} else {
  const files = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
  for (const f of files) {
    try {
      if (statSync(f).size < 20 * 1024 * 1024) scan(readFileSync(f).toString("utf8"), f, hits);
    } catch {
      // deleted in the working tree
    }
  }
}

const unique = [...new Set(hits)];
if (unique.length) {
  console.error(`Secret scan FAILED (${unique.length}):`);
  for (const h of unique) console.error(`  ${h}`);
  process.exit(1);
}
console.log("Secret scan passed: no server secret found.");
