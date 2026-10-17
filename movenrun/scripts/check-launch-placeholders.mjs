#!/usr/bin/env node
// Fails while any public policy page still carries an owner placeholder such
// as {{SUPABASE_PUBLISHABLE_KEY}}, or carries a value that must never be
// public. Run before deploying the website for a Play release:
//   node scripts/check-launch-placeholders.mjs
//
// The site has no build step. At publish time the owner fills the one
// remaining value in website/account-deletion/index.html by hand (the
// Supabase publishable key, `sb_publishable_…`, which is public by design),
// then runs this check. A secret key (`sb_secret_…`) or a legacy JWT key is
// refused here, and the page itself also refuses a secret key.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
let problems = 0;
const fail = (msg) => {
  console.error(msg);
  problems++;
};
const metaValue = (html, name) => html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1];
const placeholder = (v) => /^\{\{.*\}\}$/.test(v);

for (const page of ["privacy", "account-deletion", "support", "sign-in"]) {
  const html = readFileSync(join(site, page, "index.html"), "utf8");
  const found = [...new Set(html.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
  for (const token of found) fail(`${page}: ${token} is not filled in`);

  const api = metaValue(html, "movenrun-api");
  if (api !== undefined && !placeholder(api) && !/^https:\/\/[a-z0-9.-]+$/.test(api)) fail(`${page}: movenrun-api must be an https origin with no path`);

  const key = metaValue(html, "movenrun-supabase-publishable-key");
  if (key !== undefined && !placeholder(key)) {
    if (/^sb_secret_/.test(key) || /^eyJ/.test(key)) fail(`${page}: the Supabase key is not a publishable key; remove it now`);
    else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) fail(`${page}: the Supabase key does not look like sb_publishable_…`);
  }
}
if (problems) process.exit(1);
console.log("Policy pages are ready to publish.");
