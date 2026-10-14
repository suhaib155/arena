# Design constraints (owner decisions, 14 Oct 2026)

These are binding rules for website, documentation and the future app brief.
They override earlier design notes where they conflict.

## Product identity

- **Core pillars:** MovenRun is a territory strategy and movement game. Clubs,
  districts, sealing, territory control and Deeds are core product pillars.
  They stay on the website, in the docs and on the roadmap.
- **Status labels:** each pillar is labelled with its true status: available,
  preview, or planned. Use a subtle label, never repeated caveats.
- **No fake features:** no multiplayer, ownership or income is shown as live
  when it is not.

## Map and visuals

- **H3 is internal.** Hexagonal cells are a backend index for lookup,
  deduplication and settlement. They are never drawn as the visual language:
  no hex grids, hex frames or hex logos.
- **Real map, coloured areas.** The future app map is a real, detailed base
  map with recorded routes and colour-filled geographic areas. Areas are
  produced by `docs/TERRITORY_GEOMETRY.md`.
- **Area states:** covered, held, contested and at risk. Each is shown only
  once the server computes it.
- **Website look:** keep the premium illustrated style, motion and
  cartographic coherence.

## Website

- **Responsive:** at 320, 360, 390, 768, 1024 and 1440 px, and at large text.
- **No app promotion:** no download, install, beta or waitlist buttons, no
  store badges and no "get the app" routes. Documentation and whitepaper
  links are welcome.
- **No public dates or times:** no publication, effective or launch dates and
  no countdowns. If a legal date is ever mandatory, flag it to the owner.
- **No fixed support response time.** Contact is `info@movenrun.xyz`, signed
  Team MovenRun.
- **Manual deletion:** "within 30 days" is shown only once operating evidence
  exists (`docs/play-launch/ACCOUNT_DELETION_OPERATIONS.md`). Shorter legal
  deadlines win.
- **Network terms:** mainnet is mentioned once, in the technical roadmap, as
  an objective for the official launch. It is never described as done. No
  network labels or contract addresses on marketing pages.
- **Wallet sign-in failures:** never suggest that email support can complete
  a wallet sign-in. Never ask for a recovery phrase, a private key, a
  signature or a sign-in code.
- **Publishing:** propose, preview, review, then publish. Publishing needs
  X-21 approval.

## Mobile app

- **On hold.** No change to screens, navigation, components, icons, assets,
  motion, visual tests or maps until the owner gives a mobile design
  instruction. The rules above are input for that brief, not permission to
  start.
