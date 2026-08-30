"use strict";
/**
 * GET /api/deed-image/:tokenId — the deed's image.
 *
 * Generated from the cell id rather than fetched. There is no image host behind
 * this and no IPFS pin, so the honest options were "generate deterministically"
 * or "claim a permanence nobody has arranged". This is the first.
 */
const { parseTokenId, deedImageSvg } = require("../_lib/deedMetadata");

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
    res.status(400).json({ error: "invalid_token_id" });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).send(deedImageSvg(tokenId));
};
