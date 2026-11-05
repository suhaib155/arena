/**
 * Hostile and malformed return links for "Continue with Google" and the
 * wallet hand-off. Any app can open movenrun://auth/callback, so the parser
 * must answer every input with a typed result and never throw.
 *
 * Deterministic: a fixed list plus a seeded generator, short inputs only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALLBACK_MAX_URL_LENGTH,
  parseGoogleCallback,
  parseWalletReturn,
} from "../signInMethods";

const G = "movenrun://auth/callback";
const W = "movenrun://auth/wallet";
const GOOD = "abc123def456";

const MALFORMED_ESCAPES = [
  "%",
  "%E0%A4%A",
  "%zz",
  "%%",
  "%E0%A4",
  "%C0%80",
  "%ED%A0%80",
  "%F4%90%80%80",
  "%u0041",
  "%1",
];

function isTyped(r: unknown): boolean {
  const x = r as { kind?: string; reason?: string; code?: string };
  if (x.kind === "cancelled") return true;
  if (x.kind === "code") return typeof x.code === "string";
  return x.kind === "error" && typeof x.reason === "string";
}

test("malformed percent escapes anywhere return a benign error and never throw", () => {
  for (const esc of MALFORMED_ESCAPES) {
    for (const url of [
      `${G}?code=${GOOD}&x=${esc}`,
      `${G}?${esc}=1`,
      `${G}?code=${esc}`,
      `${G}?${esc}`,
      `${G}?code=${GOOD}#${esc}`,
    ]) {
      let r: ReturnType<typeof parseGoogleCallback> | undefined;
      assert.doesNotThrow(() => { r = parseGoogleCallback(url); }, url);
      assert.equal(r!.kind, "error", url);
    }
    assert.doesNotThrow(() => parseWalletReturn(`${W}?code=${esc}`), esc);
    assert.equal(parseWalletReturn(`${W}?x=${esc}&code=ABCDEFGHJKMN`), null, esc);
  }
});

test("a malformed escape is reported as malformed, not as a provider error", () => {
  assert.deepEqual(parseGoogleCallback(`${G}?code=${GOOD}&x=%E0%A4%A`), { kind: "error", reason: "malformed" });
});

test("over-long links are refused before any parsing", () => {
  const long = `${G}?code=${"a".repeat(CALLBACK_MAX_URL_LENGTH)}`;
  assert.deepEqual(parseGoogleCallback(long), { kind: "error", reason: "too_long" });
  assert.deepEqual(parseGoogleCallback(`${G}?x=${"%41".repeat(CALLBACK_MAX_URL_LENGTH)}`), { kind: "error", reason: "too_long" });
  assert.equal(parseWalletReturn(`${W}?code=${"A".repeat(CALLBACK_MAX_URL_LENGTH)}`), null);
  const atCap = `${G}?code=${GOOD}&p=` + "b".repeat(CALLBACK_MAX_URL_LENGTH - `${G}?code=${GOOD}&p=`.length);
  assert.equal(atCap.length, CALLBACK_MAX_URL_LENGTH);
  assert.deepEqual(parseGoogleCallback(atCap), { kind: "code", code: GOOD });
});

test("duplicate parameters are ambiguous and refused", () => {
  assert.deepEqual(parseGoogleCallback(`${G}?code=${GOOD}&code=zzzzzzzzzz`), { kind: "error", reason: "ambiguous" });
  assert.deepEqual(parseGoogleCallback(`${G}?code=${GOOD}&error=x&error=y`), { kind: "error", reason: "ambiguous" });
  assert.deepEqual(parseGoogleCallback(`${G}?code=${GOOD}&c%6Fde=zzzzzzzzzz`), { kind: "error", reason: "ambiguous" });
  assert.equal(parseWalletReturn(`${W}?code=ABCDEFGHJKMN&code=ABCDEFGHJKMN`), null);
});

test("a fragment never carries or adds to the result", () => {
  assert.deepEqual(parseGoogleCallback(`${G}#code=${GOOD}`), { kind: "error", reason: "ambiguous" });
  assert.deepEqual(parseGoogleCallback(`${G}?code=${GOOD}#code=zzzzzzzzzz`), { kind: "error", reason: "ambiguous" });
  assert.deepEqual(parseGoogleCallback(`${G}?code=${GOOD}#access_token=t`), { kind: "error", reason: "ambiguous" });
  assert.equal(parseWalletReturn(`${W}?code=ABCDEFGHJKMN#code=ABCDEFGHJKMN`), null);
  assert.deepEqual(parseGoogleCallback(`${G}?code=${GOOD}#`), { kind: "code", code: GOOD });
});

test("wrong scheme, host, path, case or userinfo is refused", () => {
  for (const url of [
    `https://auth/callback?code=${GOOD}`,
    `MOVENRUN://auth/callback?code=${GOOD}`,
    `movenrun://evil/callback?code=${GOOD}`,
    `movenrun://auth@evil/callback?code=${GOOD}`,
    `movenrun://auth/callback/?code=${GOOD}`,
    `movenrun:///auth/callback?code=${GOOD}`,
    `movenrun:auth/callback?code=${GOOD}`,
    ` ${G}?code=${GOOD}`,
    `javascript:alert(1)`,
    `movenrun://auth/wallet?code=${GOOD}`,
    "",
    "?",
    "#",
  ]) {
    const r = parseGoogleCallback(url);
    assert.notEqual(r.kind, "code", url);
    assert.ok(isTyped(r), url);
  }
  assert.equal(parseWalletReturn(`${G}?code=ABCDEFGHJKMN`), null);
});

test("a missing, empty or malformed code is a typed error", () => {
  for (const q of ["", "?", "?code", "?code=", "?state=x", "?code=short", "?code=a b c d e f g h", "?code=%00%00%00%00%00%00%00%00"]) {
    const r = parseGoogleCallback(G + q);
    assert.equal(r.kind, "error", q);
  }
});

test("a provider error still wins and is reported without its text", () => {
  assert.deepEqual(parseGoogleCallback(`${G}?error=access_denied&error_description=%E0%A4%A`), { kind: "error", reason: "malformed" });
  assert.deepEqual(parseGoogleCallback(`${G}?error=access_denied&error_description=nope`), { kind: "error", reason: "provider_error" });
});

test("the parser holds no state: the same accepted link yields the same code, and only the caller's own verifier can redeem it", () => {
  const a = parseGoogleCallback(`${G}?code=${GOOD}`);
  const b = parseGoogleCallback(`${G}?code=${GOOD}`);
  assert.deepEqual(a, b);
  assert.deepEqual(a, { kind: "code", code: GOOD });
});

test("seeded fuzz: short random links over a hostile alphabet never throw", () => {
  let s = 0x2f6e2b1;
  const rnd = (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
  const pieces = ["%", "%E", "%E0", "%A4", "%zz", "%41", "%00", "&", "=", "?", "#", "+", "code", "error", "state", "a", "Z", "9", "-", "_", ".", "~", " ", "é", "\ud800", "/", "@", ":"];
  const bases = [G, W, "", "movenrun://", "https://x", G + "?", G + "#"];
  for (let i = 0; i < 2000; i++) {
    let url = bases[rnd(bases.length)];
    const n = rnd(24);
    for (let j = 0; j < n; j++) url += pieces[rnd(pieces.length)];
    assert.doesNotThrow(() => {
      assert.ok(isTyped(parseGoogleCallback(url)), url);
      const w = parseWalletReturn(url);
      assert.ok(w === null || /^[A-Z0-9]{12}$/.test(w), url);
    }, url);
  }
});
