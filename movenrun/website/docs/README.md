# MovenRun Docs — maintainer guide

GitBook-style static documentation portal + the 2026 whitepaper. **Zero build
step, zero dependencies** — every page is a complete static HTML file.

## Layout

- `*/index.html` — 28 pages in five sidebar groups (Start here, Product,
  Status & roadmap, Technology, Trust & support). Clean directory URLs
  (`/docs/product/core-loop/`).
- `assets/docs.css` — the shared shell: header, sidebar, article typography,
  status badges, tables, figures, search modal, responsive + print styles.
- `assets/docs.js` — progressive enhancement only (drawer, search, heading
  anchors, code copy, TOC scrollspy, print button). Pages are fully readable
  with JavaScript disabled.
- `assets/search-index.json` — the client-side search index.
- `assets/diagrams/*.svg` — 10 original diagrams in the brand palette.

## Editing a page

Each page's article lives inside `<article class="darticle">…</article>`.
Everything outside the article (header, sidebar, breadcrumbs, prev/next,
footer) is the shared shell — if you change shell markup, change it on every
page (the shell is identical by construction).

Conventions inside articles:

- One `<h1>`; sections are `<h2 id="…">`; sub-sections `<h3 id="…">` (ids feed
  the TOC and heading anchors).
- Tables: wrap in `<div class="tscroll">` and include a `<caption>`.
- Diagrams: `<figure class="dfig"><img src="/docs/assets/diagrams/x.svg"
  alt="full description" width height /><figcaption>…</figcaption></figure>`.
  Meaningful information must also exist in surrounding text.
- Callouts: `<div class="callout note|warn"><p>…</p></div>`.
- Status badges: `<span class="badge b-impl|b-prev|b-infra|b-test|b-review|b-plan|b-cond|b-hist">…</span>`.
- Update the "Last reviewed" date in the page's `.dmeta` when content changes.

## Adding a page

1. Create `docs/<section>/<slug>/index.html` by copying a sibling page.
2. Update its `<title>`, meta description, canonical URL, OG tags, `<h1>`,
   badge, and article body.
3. Add the link to the sidebar `<details class="dgroup">` block **in every
   page** (the sidebar is static HTML for no-JS support).
4. Update the prev/next links on the new page and its two neighbors.
5. Append an entry to `assets/search-index.json`
   (`{title, section, url, description, headings[], keywords}`).
6. Add the URL to `../sitemap.xml`.

## Status vocabulary (use these exact terms)

Implemented · Local preview · Infrastructure · Experimental testnet ·
Under review · Planned · Conditional · Historical.

Never write: "live" (unless actually live), "production-ready", "audited"
(without an independent audit), "decentralized", "guaranteed", "risk-free",
or "earn" implying financial return.

## Source-of-truth hierarchy

When sources disagree: (1) merged code on `main` → (2) verified deployment
records → (3) merged PRs → (4) internal roadmap/architecture docs →
(5) open PRs, labeled *Under review* → (6) historical plans, labeled
*Historical* → (7) explicit assumptions. Always pick the most conservative
status. Open PRs are never described as shipped; testnet is never described
as production; nothing implies mainnet, prices, sales, yields, or real-world
land ownership.

## Web3 safety rules

No investment language, sale/purchase CTAs, exchange links, contract-address
promotion, price/ROI/APY talk, or earning claims. Historical tokenomics are
labeled *legacy experimental V1 design*. The standing disclaimer block in the
whitepaper must remain.

## Validation checklist before shipping doc changes

1. Serve `movenrun/website/` with any static server; hard-refresh a deep URL.
2. Link check: every sidebar/prev-next/inline link resolves; no `href="#"`.
3. Prohibited-term scan (see `../README.md` for the term list).
4. Viewports: 360/375/390/430/768/820/1024/1280/1440/1920 wide —
   `document.documentElement.scrollWidth === clientWidth` everywhere.
5. Keyboard: `/` opens search, Escape closes, drawer focus returns to trigger.
6. Reduced motion: pages stay complete and readable.
7. Print preview the whitepaper.
