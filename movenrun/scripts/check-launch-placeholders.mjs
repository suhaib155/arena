#!/usr/bin/env node
// Fails while any public policy page still carries an owner placeholder such
// as {{SUPPORT_EMAIL}}. Run before deploying the website for a Play release:
//   node scripts/check-launch-placeholders.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "website");
let missing = 0;
for (const page of ["privacy", "account-deletion", "support", "sign-in"]) {
  const html = readFileSync(join(site, page, "index.html"), "utf8");
  const found = [...new Set(html.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
  for (const token of found) console.error(`${page}: ${token} is not filled in`);
  missing += found.length;
}
if (missing) process.exit(1);
console.log("Policy pages are ready to publish.");
