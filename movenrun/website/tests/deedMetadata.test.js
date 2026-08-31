"use strict";
/**
 * Deed metadata — validation, determinism, and what the document may claim.
 *
 * Two properties are under test. The first is that untrusted path input cannot
 * become anything but a canonical in-range token id. The second is that the
 * document says only what is true: which cell, at which resolution, in which
 * registry once one exists — and nothing about money.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_TOKEN_ID,
  H3_RESOLUTION,
  parseTokenId,
  cellIdHex,
  deedImageSvg,
  deedMetadata,
} = require("../api/_lib/deedMetadata");

const CELL = 613196570331971583n;
const ORIGIN = "https://movenrun.example";

/* ── id validation ────────────────────────────────────────────────────────── */

test("accepts exactly the canonical decimal ids the registry can issue", () => {
  assert.equal(parseTokenId("0"), 0n);
  assert.equal(parseTokenId("1"), 1n);
  assert.equal(parseTokenId(CELL.toString()), CELL);
  assert.equal(parseTokenId(MAX_TOKEN_ID.toString()), MAX_TOKEN_ID);
});

test("refuses anything that is not a canonical in-range decimal id", () => {
  const rejected = [
    // Out of range — no cell can produce these.
    (MAX_TOKEN_ID + 1n).toString(),
    "99999999999999999999999999",
    // Non-canonical spellings, so one cell cannot have two URLs.
    "01", "007", "+1", "-1", " 1", "1 ", "1\n",
    // Not decimal integers at all.
    "", "abc", "0x1f", "1e10", "1.0", "1,0", "NaN", "Infinity",
    // Path and injection shapes. None of these reach any other code.
    "..", "../..", "%2e%2e", "../../etc/passwd", "/etc/passwd",
    "1/../2", "1?x=2", "1#frag", "index.html", "__proto__", "constructor",
    // Wrong types entirely.
    null, undefined, 1, {}, [], ["1"],
  ];
  for (const value of rejected) {
    assert.equal(parseTokenId(value), null, `${String(value)} must be refused`);
  }
});

test("bounds the input before parsing it", () => {
  // A very long run of digits is rejected on length, so BigInt never sees it.
  assert.equal(parseTokenId("9".repeat(100000)), null);
  assert.equal(parseTokenId("1".repeat(21)), null);
});

/* ── determinism ──────────────────────────────────────────────────────────── */

test("the same id always produces the same document and the same image", () => {
  const a = deedMetadata(CELL, { origin: ORIGIN });
  const b = deedMetadata(CELL, { origin: ORIGIN });
  assert.deepEqual(a, b);
  assert.equal(deedImageSvg(CELL), deedImageSvg(CELL));
});

test("different cells produce different documents and different images", () => {
  const a = deedMetadata(CELL, { origin: ORIGIN });
  const b = deedMetadata(CELL + 1n, { origin: ORIGIN });
  assert.notEqual(a.name, b.name);
  assert.notEqual(a.image, b.image);
  assert.notEqual(deedImageSvg(CELL), deedImageSvg(CELL + 1n));
});

test("the cell is presented in canonical H3 hex", () => {
  assert.equal(cellIdHex(CELL), CELL.toString(16));
  const meta = deedMetadata(CELL, { origin: ORIGIN });
  const cell = meta.attributes.find((a) => a.trait_type === "H3 Cell");
  assert.equal(cell.value, CELL.toString(16));
  // The decimal token id is kept too, since that is what the contract uses.
  const id = meta.attributes.find((a) => a.trait_type === "Token ID");
  assert.equal(id.value, CELL.toString());
});

/* ── the standard shape ───────────────────────────────────────────────────── */

test("carries the fields a marketplace reads", () => {
  const meta = deedMetadata(CELL, { origin: ORIGIN });
  for (const key of ["name", "description", "image", "attributes"]) {
    assert.ok(meta[key], `${key} is required`);
  }
  assert.equal(meta.image, `${ORIGIN}/api/deed-image/${CELL.toString()}`);
  assert.ok(Array.isArray(meta.attributes));
  assert.equal(
    meta.attributes.find((a) => a.trait_type === "H3 Resolution").value,
    H3_RESOLUTION,
  );
  // Matches the contract constant and shared/src/constants/h3.ts.
  assert.equal(H3_RESOLUTION, 8);
});

test("a trailing slash on the origin does not produce a double slash", () => {
  const meta = deedMetadata(CELL, { origin: `${ORIGIN}///` });
  assert.equal(meta.image, `${ORIGIN}/api/deed-image/${CELL.toString()}`);
});

/* ── honesty ──────────────────────────────────────────────────────────────── */

test("says nothing about price, yield, or return", () => {
  const meta = deedMetadata(CELL, {
    origin: ORIGIN,
    registryNetwork: "Base",
    registryAddress: "0x" + "ab".repeat(20),
  });
  /* Prose only — the human-readable strings a person or a marketplace actually
     renders. Scanning the raw JSON instead flagged `"value"`, which is the
     required ERC-721 attribute KEY and not a claim about worth; a guard that
     trips on the schema it is inspecting is checking the wrong surface. */
  const prose = [
    meta.name,
    meta.description,
    ...meta.attributes.map((a) => a.trait_type),
    ...meta.attributes.map((a) => (typeof a.value === "string" ? a.value : "")),
    deedImageSvg(CELL),
  ]
    .join(" ")
    .toLowerCase();
  const text = prose;
  /* The ban is on ASSERTING any of these, not on denying them. The description
     deliberately says the deed "carries no income" and makes "no claim on any
     physical property" — a first pass at this test flagged its own disclaimer,
     which would have meant deleting the most honest sentence in the document to
     satisfy a guard. So an occurrence is an offence only when it is not negated. */
  const NEGATIONS = ["no ", "not ", "never ", "without ", "nor "];
  for (const claim of [
    "price", "worth", "yield", "apy", "apr", "roi", "return",
    "income", "revenue", "earn", "profit", "invest", "rarity", "rare",
    "floor", "valuation", "dividend", "payout", "airdrop", "guaranteed",
  ]) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(claim, from);
      if (at === -1) break;
      const before = text.slice(Math.max(0, at - 24), at);
      const negated = NEGATIONS.some((n) => before.includes(n));
      assert.ok(negated, `metadata asserts "${claim}" — "...${before}${claim}..."`);
      from = at + claim.length;
    }
  }
});

test("omits the network and registry until a deployment actually exists", () => {
  /* Naming a chain the contract is not on would be the easiest false claim in
     the whole project to make and the hardest for anyone to notice. */
  const meta = deedMetadata(CELL, { origin: ORIGIN });
  const traits = meta.attributes.map((a) => a.trait_type);
  assert.ok(!traits.includes("Network"));
  assert.ok(!traits.includes("Registry"));
  assert.ok(!JSON.stringify(meta).toLowerCase().includes("mainnet"));

  const deployed = deedMetadata(CELL, {
    origin: ORIGIN,
    registryNetwork: "Base Sepolia",
    registryAddress: "0x" + "cd".repeat(20),
  });
  assert.equal(
    deployed.attributes.find((a) => a.trait_type === "Network").value,
    "Base Sepolia",
  );
  assert.equal(
    deployed.attributes.find((a) => a.trait_type === "Registry").value,
    "0x" + "cd".repeat(20),
  );
});

test("does not imply the deed is held, or that land is owned", () => {
  const description = deedMetadata(CELL, { origin: ORIGIN }).description.toLowerCase();
  assert.ok(description.includes("no income"));
  assert.ok(description.includes("no claim on any physical property"));
  for (const claim of ["you own", "your land", "real estate", "title to"]) {
    assert.ok(!description.includes(claim), `description must not say "${claim}"`);
  }
});

/* ── the image ────────────────────────────────────────────────────────────── */

test("the image is a self-contained SVG with no external reference", () => {
  const svg = deedImageSvg(CELL);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>\s*$/);
  for (const external of ["<image", "href=", "url(http", "<script", "<foreignObject", "@import"]) {
    assert.ok(!svg.includes(external), `the image must not contain ${external}`);
  }
  assert.ok(svg.includes(cellIdHex(CELL)), "the image should identify its cell");
});

test("the image cannot be driven into malformed markup by its input", () => {
  /* The only interpolated values are a hex string and numbers derived from it,
     so there is no path for markup to appear inside the document. */
  for (const id of [0n, 1n, CELL, MAX_TOKEN_ID]) {
    const svg = deedImageSvg(id);
    assert.ok(/^[0-9a-f]+$/.test(cellIdHex(id)));
    assert.equal((svg.match(/<svg/g) || []).length, 1);
    assert.equal((svg.match(/<\/svg>/g) || []).length, 1);
  }
});
