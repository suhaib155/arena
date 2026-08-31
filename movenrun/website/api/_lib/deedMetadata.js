"use strict";
/**
 * Deterministic ERC-721 metadata for MovenRun deeds.
 *
 * Pure: no network, no filesystem, no database, no clock. The same token id
 * always produces the same document, which is what lets this be cached hard and
 * served from a static site without any state behind it.
 *
 * ## What this may and may not say
 *
 * A deed records that a specific H3 cell has one registered holder. That is the
 * whole claim. So the attributes here are limited to facts that are true by
 * construction — which cell, at which resolution, in which registry — and the
 * document deliberately contains no price, valuation, yield, APY, rarity score,
 * projected income, or investment language of any kind. None of that exists,
 * and metadata is exactly where such a claim would be most likely to be
 * believed and least likely to be read carefully.
 *
 * The registry's network and address are attributes only when they have been
 * configured. Until a registry is actually deployed there is nothing truthful
 * to put there, and a placeholder naming a chain the contract is not on would
 * be worse than their absence.
 */

/** H3 cell ids are 64-bit, and so is every token id this registry can issue. */
const MAX_TOKEN_ID = (1n << 64n) - 1n;

/** Matches the `H3_RESOLUTION` constant in the registry and in shared/. */
const H3_RESOLUTION = 8;

/**
 * Parse a token id from a URL path segment, or reject it.
 *
 * Strict on purpose. The id arrives as untrusted path input, so anything that
 * is not exactly a canonical decimal integer in range is refused rather than
 * coerced: no signs, no whitespace, no hex, no exponent, no leading zeros (so
 * one cell cannot have two URLs), and nothing above 2^64-1. `..`, `%2e%2e`, a
 * filename, or a query fragment all fail the first test and never reach any
 * other code — this module never touches the filesystem, but the validation
 * does not rely on that remaining true.
 */
function parseTokenId(raw) {
  if (typeof raw !== "string") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  // Bounded before BigInt sees it, so a megabyte of digits cannot be parsed.
  if (raw.length > 20) return null;
  const value = BigInt(raw);
  if (value > MAX_TOKEN_ID) return null;
  return value;
}

/**
 * The canonical H3 representation of a cell: lowercase hex, which is how H3
 * indexes are written everywhere else. The decimal form is an artifact of
 * ERC-721 token ids being numbers.
 */
function cellIdHex(tokenId) {
  return tokenId.toString(16);
}

/** Stable 32-bit hash, used only to pick colours. Not a security primitive. */
function colourSeed(hex) {
  let h = 0;
  for (let i = 0; i < hex.length; i++) {
    h = (Math.imul(h, 31) + hex.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * A deterministic placeholder mark for one cell.
 *
 * Generated rather than fetched: there is no image hosting behind this, and
 * pointing at IPFS would claim a permanence that has not been arranged. It is
 * a hexagon and an identifier, and it does not depict a location, a map, or
 * anything that could be read as a valuation.
 */
function deedImageSvg(tokenId) {
  const hex = cellIdHex(tokenId);
  const seed = colourSeed(hex);
  const hue = seed % 360;
  const hue2 = (hue + 38) % 360;

  // The identifier is split so a long index stays legible at thumbnail size.
  const label = hex.length > 8 ? `${hex.slice(0, 8)} ${hex.slice(8)}` : hex;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="MovenRun deed ${hex}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 62% 46%)"/>
      <stop offset="1" stop-color="hsl(${hue2} 58% 34%)"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#0f1512"/>
  <polygon points="256,74 414,165 414,347 256,438 98,347 98,165" fill="url(#g)" opacity="0.92"/>
  <polygon points="256,124 371,190 371,322 256,388 141,322 141,190" fill="none" stroke="#0f1512" stroke-opacity="0.55" stroke-width="10"/>
  <text x="256" y="470" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="26" fill="#e8efe9">${label}</text>
  <text x="256" y="52" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="22" fill="#8fa397" letter-spacing="3">MOVENRUN DEED</text>
</svg>
`;
}

/**
 * Build the metadata document.
 *
 * @param tokenId  validated BigInt token id
 * @param options  `origin` for absolute URLs; optional `registryNetwork` and
 *                 `registryAddress`, included only when actually configured.
 */
function deedMetadata(tokenId, options) {
  const opts = options || {};
  const hex = cellIdHex(tokenId);

  const attributes = [
    { trait_type: "H3 Cell", value: hex },
    { trait_type: "H3 Resolution", value: H3_RESOLUTION },
    { trait_type: "Token ID", value: tokenId.toString() },
  ];

  /* Network and registry address are facts about a deployment, so they appear
     only once a deployment exists. Naming a chain before the contract is on it
     would be a claim this project has no business making. */
  if (opts.registryNetwork) {
    attributes.push({ trait_type: "Network", value: opts.registryNetwork });
  }
  if (opts.registryAddress) {
    attributes.push({ trait_type: "Registry", value: opts.registryAddress });
  }

  const origin = (opts.origin || "").replace(/\/+$/, "");

  return {
    name: `MovenRun Deed ${hex}`,
    description:
      "A registered deed for one H3 resolution-8 cell in the MovenRun location " +
      "registry. Each cell has exactly one deed, issued only against a MovenRun " +
      "movement-verification authorization. The deed records registration of the " +
      "cell and nothing more: it carries no income, no revenue share, and no claim " +
      "on any physical property.",
    image: `${origin}/api/deed-image/${tokenId.toString()}`,
    external_url: `${origin}/`,
    attributes,
  };
}

module.exports = {
  MAX_TOKEN_ID,
  H3_RESOLUTION,
  parseTokenId,
  cellIdHex,
  deedImageSvg,
  deedMetadata,
};
