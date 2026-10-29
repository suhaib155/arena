/**
 * Guest play stays independent of sign-in providers.
 *
 * "Start exploring" must work with Google and wallet sign-in off, refused,
 * at the account cap or while the account service is down. These checks read
 * the code path: the guest choice is a local first-run transition and touches
 * no identity, Supabase or network code. This is a static, keyword-based
 * tripwire: a sign-in reached through a helper with an unlisted name would
 * not be caught.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chooseLocalBeta, FRESH_FIRST_RUN } from "../firstRun";
import { SIGN_IN_METHODS } from "../releaseScope";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

test("the guest choice is a pure local transition out of the account stage", () => {
  const next = chooseLocalBeta(FRESH_FIRST_RUN);
  assert.notEqual(next.stage, "account");
});

test("firstRun imports no identity, auth, Supabase or network module", () => {
  const imports = [...read("src", "lib", "firstRun.ts").matchAll(/^import .*from ["']([^"']+)["']/gm)].map((m) => m[1]);
  for (const i of imports) assert.doesNotMatch(i, /identity|auth|supabase|signIn|fetch|axios/i, `firstRun imports ${i}`);
});

test("the welcome screen's guest handler only records the local choice", () => {
  const src = read("app", "welcome.tsx");
  const start = src.indexOf("const onLocalBeta");
  assert.ok(start > 0);
  const body = src.slice(start, src.indexOf("};", start) + 2);
  assert.match(body, /chooseLocalBeta\(\)/);
  assert.doesNotMatch(body, /await|fetch|identityApi|signIn|google|wallet|supabase/i);
  // Provider state must not disable it: only the brief in-flight lock and the legal acceptance do.
  assert.match(src, /const locked = busy \|\| formBusy \|\| !accepted;/);
});

test("guest play is not one of the sign-in methods and cannot be switched off with them", () => {
  const scope = read("src", "lib", "releaseScope.ts");
  assert.match(scope, /Guest play is not a sign-in method and is always available/);
  assert.deepEqual(Object.keys(SIGN_IN_METHODS).sort(), ["google", "wallet"], "guest is not a switchable method");
});
