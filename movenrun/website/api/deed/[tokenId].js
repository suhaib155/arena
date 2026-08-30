"use strict";
/**
 * GET /api/deed/:tokenId — ERC-721 metadata for one deed.
 *
 * This is the path the registry's base URI points at, so the contract's
 * `tokenURI(tokenId)` resolves here. The id is the decimal token id, which is
 * the H3 cell id widened to 256 bits.
 *
 * Serving metadata for a cell that has no deed yet is deliberate and standard:
 * the document describes the cell, not a holder, and this endpoint has no chain
 * access to check ownership with. It asserts nothing about who holds anything.
 */
const { parseTokenId, deedMetadata } = require("../_lib/deedMetadata");

module.exports = function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const tokenId = parseTokenId(
    Array.isArray(req.query.tokenId) ? req.query.tokenId[0] : req.query.tokenId,
  );
  if (tokenId === null) {
    // No echo of the offending value — it is untrusted input and there is
    // nothing useful to say back about it.
    res.status(400).json({ error: "invalid_token_id" });
    return;
  }

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const origin = host ? `${proto}://${host}` : "";

  const body = deedMetadata(tokenId, {
    origin,
    registryNetwork: process.env.DEED_REGISTRY_NETWORK || null,
    registryAddress: process.env.DEED_REGISTRY_ADDRESS || null,
  });

  // Deterministic for a given id and configuration, so it caches hard. Not
  // `immutable`: the registry address becomes known at deployment, and the
  // document must be able to pick it up.
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).send(JSON.stringify(body));
};
