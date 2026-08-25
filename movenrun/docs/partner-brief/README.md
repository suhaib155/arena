# MovenRun — Partner & Economy Documents

PDFs written for a partner with **no crypto background**, which also serve as
supporting material for the Base Batches 004 application.

**Start with `MovenRun-Master.pdf`.** It is the current, complete design — the
game, the tokenomics, and the contract specification in one document. The
earlier economy drafts are kept for the reasoning trail, not as the design.

## Current documents

| File | Pages | What it is |
| --- | --- | --- |
| `MovenRun-Master.pdf` | **37** | **The design of record.** Parts A–E: the basics from zero, the game, the tokenomics, and a contract-by-contract build specification. |
| `MovenRun-Partner-Brief.pdf` | 24 | The product, the technology from zero, and the plan. Read alongside the master. |
| `MovenRun-Economy-and-Investment-Brief.pdf` | 32 | Revenue model, costs, unit economics, and the investment case. Still current for the **business** side. |

Each has a matching `.html` source of the same name (`movenrun-master.html`,
`movenrun-partner-brief.html`, `movenrun-economy-brief.html`).

## What the master document contains

- **Part A — The basics.** Two systems (game money vs company money), what a
  token is, why these economies usually fail, one token in two states
  (locked/liquid), what owning land does and does not mean.
- **Part B — The game.** Loop capture, taking ground, the seven-day siege,
  the 2% toll and its 5% ceiling, land tiers, and minting.
- **Part C — The tokenomics.** The 1B cap and the season schedule, the effort
  curve, every sink priced, staking/sponsors/voting, the whole flow on one
  page, whether it balances, and twelve attacks with their answers.
- **Part D — How to build it.** Three-layer architecture, the seven-contract
  map, per-contract specifications (state, functions, events, invariants) for
  `MoveToken`, `DeedRegistry`, `SiegeManager`, `SeasonController`,
  `BurnRouter`, `StakingVault` and `Governor`, the oracle signature payload,
  then roles, security patterns, the test matrix and the migration path.
- **Part E — Glossary and a one-page summary.**

The three properties the whole design rests on:

1. Newly minted tokens are **locked**; tokens that already existed move freely.
2. Spending consumes **locked first**, so free players are the burn engine.
3. Land earns from **traffic, not time**, so capital cannot turn ownership into
   a money printer.

## Superseded drafts

Kept because they record how the design got here, and each was reviewed against
a specific failure mode. Do not quote figures from these — the master supersedes
them all.

| File | What it explored | Why it was superseded |
| --- | --- | --- |
| `MovenRun-Economy-v3.pdf` | "Days of Walking" index pricing, a separate soft currency (Stride), Ground Rent | The soft currency increased sell pressure and reduced burn |
| `MovenRun-Economy-V5.pdf` | 14 sinks, the failure autopsy, four structural repairs | Too large; superseded by the single-token model |
| `MovenRun-Economy-V6.pdf` | Locked/liquid one token, six sinks, fixed schedule | Correct core; lacked conflict and land mechanics |
| `MovenRun-Economy-V7.pdf` | Loop capture, attack/defence, toll, tiers, mint switch | Correct mechanics; folded into the master |

## Labelling convention

Every figure is a **modelled estimate** unless it is a real contract parameter.
There are no players and no revenue yet. Participation rates, prices and the
free/paid split are our own assumptions and several will turn out to be wrong.
Nothing in these documents is financial advice or a promise of returns.

## Sources

Content is drawn from this repository so it stays consistent with what we ship:

- `movenrun/docs/knowledge-base/MOVENRUN-KNOWLEDGE-BASE.md` — the full technical
  source, including the catalogued defects the master's §26 says not to repeat
- `movenrun/docs/ROADMAP.md` — phases, guardrails, current state
- `movenrun/docs/TOKENOMICS.md` — emission, burns, zone tax, distribution
- `movenrun/docs/ARCHITECTURE.md` — oracle flow, GPS pipeline, H3 grid
- `movenrun/docs/CONTRACTS_AUDIT.md` — the deployed Base Sepolia contracts
- `movenrun/contracts/src/` — the live contract parameters
- `movenrun/website/` — public product narrative

## Regenerating a PDF

```bash
cd movenrun/docs/partner-brief
chromium --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=MovenRun-Master.pdf \
  --virtual-time-budget=6000 \
  file://$PWD/movenrun-master.html
```

Substitute the file pair for any other document. Any Chromium/Chrome build
works. Each HTML file is self-contained — no external fonts, scripts or images
— so the output is deterministic. A4, print colours forced on.

After regenerating, check for orphan pages (a section spilling a few lines onto
a near-empty page). All diagrams are inline SVG using the **Daylight
Cartography** palette shared with `movenrun/website/css/style.css` and
`movenrun/mobile/src/theme.ts`.
