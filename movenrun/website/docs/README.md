# MovenRun Docs — maintainer guide

Self-contained, GitBook-style documentation portal + the MovenRun whitepaper.
**Zero build step, zero dependencies** — every page is a complete static HTML
file. The docs are the source of truth about the project; they do not link out
to code, issue trackers, or external references.

## Layout

- `*/index.html` — the documentation pages, in five sidebar groups
  (Start here, Product, Technology, Roadmap, Resources). Clean directory URLs
  (e.g. `/docs/technology/architecture/`).
- `assets/docs.css` — the shared shell: header, sidebar, article typography,
  tables, figures, search modal, responsive + print styles.
- `assets/docs.js` — progressive enhancement only (drawer, search, heading
  anchors, code copy, TOC scrollspy, print button). Pages are fully readable
  with JavaScript disabled.
- `assets/search-index.json` — the client-side search index.
- `assets/diagrams/*.svg` — original diagrams in the brand palette.

## How the pages are produced

The pages, sidebar, prev/next, `search-index.json`, and `../sitemap.xml` are
generated from a single page registry + content modules kept in the team's
docs toolchain, so the shell stays identical across every page. When editing:

- Each page's article lives inside `<article class="darticle">…</article>`;
  everything outside it is the shared shell.
- One `<h1>` per page; sections are `<h2 id="…">`, sub-sections `<h3 id="…">`
  (ids feed the on-page table of contents and heading anchors).
- Tables: wrap in `<div class="tscroll">` and include a `<caption>`.
- Diagrams: `<figure class="dfig"><img src="/docs/assets/diagrams/x.svg"
  alt="full description" width height /><figcaption>…</figcaption></figure>`.
  Every diagram's meaning must also exist in the surrounding text.
- Callouts: `<div class="callout note|warn"><p>…</p></div>`.
- If you add or remove a page, update the sidebar on **every** page, the
  prev/next links, `search-index.json`, and `../sitemap.xml` together.

## Voice & content rules

- **Professional, confident, product-first.** Write like a serious onchain
  project's whitepaper: explain the product, the technology, why it's better,
  and how the economy and governance work.
- **The docs are self-contained.** No links to code, repositories, issue
  trackers, PRs, or external documentation; no "references" section. The docs
  themselves are the reference.
- **Say which things exist.** The onchain layer is a design, not a
  description. Eight contracts are deployed to Base Sepolia (chain 84532,
  27 May 2026); nothing is on Base mainnet; no Zone Deed or $MOVE has been
  minted; one account holds `DEFAULT_ADMIN_ROLE` on all eight and is also the
  oracle operator, keeper and treasury; no timelock is deployed; no embedded
  wallet provider has been chosen and there is no gas sponsorship. Zones,
  battles and balances live in Postgres. Clubs are a local preview that does
  not sync. Write "Base Sepolia" wherever the testnet is meant, and never in a
  footnote.
- **Design tense for designs.** Describe the protocol, token, and governance
  as the network's design, in future or conditional tense, so a reader who
  opens the code finds nothing on the page that contradicts it. Where
  something overstates what exists, describe what it actually does rather than
  deleting the ambition.
- **Plain, direct, slightly understated.** No em or en dashes; no "not just X
  but Y"; no colon-then-reveal headlines; no sentence fragments as
  one-liners; no reflexive lists of three. Avoid seamlessly, effortlessly,
  powerful, robust, cutting-edge, revolutionise, unlock, empower, elevate,
  redefine, at its core, imagine a world, the future of. Vary sentence
  length, and prefer the concrete: "you claim the hexes inside your loop"
  over "a novel territorial capture mechanic". No hedge on every sentence
  either; a page drowning in caveats reads as badly as one that overclaims.

## Non-negotiable safety line

Keep these, always:

- A clear **development-stage / forward-looking / not-financial-advice**
  disclaimer (see `trust/disclaimers/`), and the short note in the whitepaper.
- **No claim that contradicts the repo.** Before shipping copy about
  ownership, the token, wallets, gas, or governance, check it against
  `contracts/deployments/baseSepolia.json`, `backend/src/db/schema.ts`, and
  `docs/adr/0011-provider-selection.md`.
- **No** token price, ROI/APY, promised returns, "earn money" language, or
  buy/sale/presale CTAs anywhere. The token and ownership are presented as
  protocol design, not as a financial offer.

## Diagrams

Diagrams are generated as standalone SVGs in the brand palette. Every `<text>`
value must escape `&` as `&amp;` to stay valid XML. Keep meaning legible at
360px width, don't rely on color alone, and give each an accurate `alt` +
`<figcaption>`.

## Validation checklist before shipping doc changes

1. Serve `movenrun/website/` with any static server; hard-refresh a deep URL.
2. Link check: every sidebar/prev-next/inline link and diagram path resolves;
   no `href="#"`; no external/reference links.
3. Content scan: no price/ROI/APY/returns/"earn"/buy-CTA language outside the
   disclaimer; the disclaimer is present.
4. Diagram XML: every SVG parses as well-formed XML, and no `<text>` label
   claims something the prose says is planned.
5. Viewports: 360/375/390/430/768/820/1024/1280/1440/1920 wide —
   `document.documentElement.scrollWidth === clientWidth` everywhere, tables
   scroll inside their own container.
6. Keyboard: `/` opens search, Escape closes, drawer focus returns to trigger.
7. Reduced motion: pages stay complete and readable. Print-preview the whitepaper.
