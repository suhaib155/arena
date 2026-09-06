# Daylight Cartography — the design system, and what it does not claim

The mobile app's visual rules live in code, not here. This document says where
each rule lives, why it exists, and — where a rule looks like a guarantee —
exactly how far it goes.

## Where the rules are

| Concern | Module | Guard |
| --- | --- | --- |
| Brand hues, spacing, radius, shadows, type, motion | `mobile/src/theme.ts` | — |
| Shape and press feedback | `mobile/src/lib/shape.ts` | `designSystem.test.ts`, `uiGuards.test.ts` |
| Readable colour, fills, status tones | `mobile/src/lib/tone.ts` | `colorTokens.test.ts` |
| The dark ground and what may be written on it | `mobile/src/lib/tone.ts` | `immersiveTokens.test.ts` |
| Rank titles and the level header model | `mobile/src/lib/playerRank.ts` | `playerRank.test.ts` |
| The screen header | `mobile/src/components/ScreenHeader.tsx` | `screenHeader.test.ts` |
| The resource header, mission hero, ground panels | `mobile/src/components/` | `gameHud.test.ts` |

`shape.ts` and `tone.ts` are deliberately free of `react-native` imports, so the
rules are unit-testable on plain Node. `theme.ts` re-exports both, so screens
keep a single `@/theme` import.

## Two colour systems, one of which had no name

`palette` is a **brand** palette. Its hues are tuned to be vivid on a white
page, and vivid is not the same job as legible:

| Brand hue | On white |
| --- | --- |
| `pulseGreen` `#18C987` | 2.16:1 |
| `moveGold` `#F7B955` | 1.75:1 |
| `heatCoral` `#FF6B4A` | 2.82:1 |

Every screen that needed to *write* something in a brand colour had worked
around this by hand-mixing a darker variant — `#0A8F60`, `#B07908`, `#C2492E` —
and those three literals had spread to about eighty call sites across
twenty-eight files. The pale fills behind them went the same way: three
different greens for one job, and two neutrals a single hex digit apart.

`tone.ts` names that second system:

- **core** — the brand hue. Fills, dots, meters, icons on a tint. Never text.
- **ink** — the readable-on-light variant of the same hue.
- **tints** — opaque pale fills for a *shape*. Not a text background.
- **canvas** — the greys the abstract map is drawn on. These carry no meaning
  and must never be used to say something.

Tinting an arbitrary caller-supplied colour goes through one of three named
alphas — `softTint` (fill), `strongTint` (emphasis), `hairline` (1px border) —
replacing thirteen different ad-hoc alphas spread across 132 call sites.

## The contrast floor, stated precisely

Every `ink` clears **4.5:1 against all four surfaces the app writes it on**: the
white card, the page, and a `softTint` chip of its own core composited over
each. Hue is the core's, within 0.65°; saturation is inherited from whatever
the screens had already mixed by hand, because a desaturated coral was a
deliberate choice rather than a failed brand match.

`colorTokens.test.ts` computes those ratios from the hex values with its own
WCAG implementation — it does not import the app's, which would only prove the
app agrees with itself — and anchors that implementation against values the
specification fixes (21:1 for black on white, 4.54:1 for `#767676` on white).

**This is not a conformance claim.** A ratio is a property of two colours. It
says nothing about the size text is finally rendered at, what is layered over
it, dynamic type, or a control obscured by a sibling. Device verification with
a screen reader and large type remains a release gate.

## The game layer

Everything above describes a calm, legible, light interface, and the app needs
to stay one — it is used outdoors, in daylight, by someone who is walking. But a
territory game that looks like a settings screen is not a territory game, and
the app had drifted there: Home opened on "Good morning" above four white cards
of near-equal weight, progress was a stat card on one screen and a different
stat card on another, and nothing carried a *player* between screens.

Three components answer that, and they are deliberately few.

**`PlayerHud`** — the resource header on Home. Hex crest, name, `LV n · RANK`,
the two resource pills, and the bar to the next level. Profile draws the same
vocabulary at crest size from the same pieces (`Hexagon`, `ResourcePill`,
`hudProgress`) rather than embedding the header twice, so the two agree by
construction without either screen showing a second identity block. Its model is
`lib/playerRank.ts`, which is pure: `getLevelInfo()` stays the single
owner of the curve, and a rank is a *label* computed from a level — it grants no
XP, no territory, no Locked MOVE and no eligibility, so there is nothing here
for a server to disagree with later.

**`MissionCard`** — the spotlight, and the only place a screen renders a primary
action. **`GroundPanel`** — the same dark surface with no action, for the one
thing a screen most needs read correctly (a route's sealing state, a
verification verdict).

### Why a second surface, and why only three components may declare it

The dark ground is the app's only inverted surface and its whole value is that
it is rare: on a light screen, one dark object is found before it is read. A
hand-rolled fourth would make it a pattern rather than a signal, so
`gameHud.test.ts` asserts that only `HexField`, `MissionCard` and `GroundPanel`
declare `backgroundColor: ground.base`. Everything else composes them.

The second reason is measurement. `ink` and `colors.text*` clear 4.5:1 against
the *white* surfaces `colorTokens.test.ts` measures, and say nothing about a
dark one — where `baseBlue` lands at 3.82:1 and `deedViolet` at 3.80:1. So the
ground has its own ramp, held to the same floor by `immersiveTokens.test.ts`:

- **`ground`** — `base`, `raised`, `edge`. `edge` is a hairline and is excluded
  from the text floor by name, not by omission.
- **`onGround`** — the neutral text ramp, mirroring `colors.text/textDim/textFaint`.
- **`groundInk`** — brand hues readable on the ground. Only `blue` and `violet`
  move, and only in lightness; the four that already clear the floor are their
  cores unchanged, and the test asserts that a hue is lifted *only* when the
  core actually fails. Hue holds within 0.3°.

The same caveat applies as everywhere else here: a ratio is a property of two
colours and is not a conformance claim.

### The one honesty rule the header cannot state in a sentence

Locked MOVE has no ledger. Nothing is earned, nothing is spent, and the figure
is derived from XP so the shape of the reward loop is visible
(`lib/lockedMove.ts`). Every full-size surface says that in a sentence beside
the number. A pill on four screens has no room for a sentence, and a gold pill
reading "128 MOVE" next to a real XP total *is* a balance to anyone reading it.

So the qualifier is a prop rather than a footnote: `ResourcePill` renders
`note="preview"` inside the pill, and the spoken label carries the whole
sentence. `gameHud.test.ts` asserts that every `unit="MOVE"` call site passes
both — that the visible qualifier is there, that the spoken one says "preview"
and says what it is not, and that the prop is genuinely optional-but-rendered in
the component, so correct call sites cannot sit above a pill that shows nothing.

### What the backdrop is not

`HexField` draws the lattice behind a mission card in code rather than shipping
the design guide's photoreal isometric renders. The bundle size is the smaller
reason. The real one is that the app has exactly one surface that shows real
ground — `components/map/MovenMap`, on real H3 geometry — and a second surface
that *looks* like a map is how decoration gets mistaken for territory. The
lattice is unmistakably abstract: no route, no roads, no labels, no held or
rival states, nothing that reads as a location. It is static, hidden from
assistive technology, and `pointerEvents="none"`.

The same reasoning removed the hand-drawn map from the Move readiness screen —
two grey roads, a green hex and a location pin, none of it anywhere, on the one
screen where the app has no location yet.

## The screen header

Twenty-four screens hand-rolled a back or close control. The geometry had
survived copy-paste, but the glyph was 22, 24, 26 or 28pt; back was
`colors.text` while dismiss was `colors.textDim`; the spacer that keeps the
title centred was a style on most screens and an inline width on others; one
screen's control had no size at all; one put `onPress` directly on an
`<Ionicons>` — a press target with no role, no label, no feedback, and no touch
target, invisible to every existing guard because it was not a `Pressable`.

**None of the twenty-four carried an `accessibilityLabel`.**

`ScreenHeader` supplies the label by construction, which is the only way
twenty-four screens get one and keep it. `screenHeader.test.ts` bans a
twenty-fifth hand-rolled header and bans `onPress` on a bare icon.

## Guards that were checking the wrong thing

Two pre-existing guards were passing for the wrong reason. Both are recorded
here because the pattern matters more than the individual bugs.

1. **`designSystem.test.ts` could not see a tinted icon tile.** Its scan used
   `/(\w+):\s*\{([^{}]*?)\}/gs`, and `[^{}]` crosses neither brace — so any
   style block containing a `` `${…}` `` template literal was never matched at
   all. A tinted icon tile is the most likely thing to be hand-rolled, and
   interpolating the tint is how you hand-roll one, so the rule was blind to
   precisely its own subject. **Twenty real violations** were sitting in the
   corpus while it reported none. Verified by restoring the old regex and
   confirming a hand-rolled tile with an interpolated tint passes it.

2. **The press-feedback rule measured duplication, not coverage.** Its
   `total > 40` was a genuine fail-closed property, but the number only held
   while twenty-four screens repeated themselves. It now compares a naive regex
   against the brace-aware parser, which is count-independent. Both forms catch
   a fully broken parser; only this one survives the app being consolidated.

Every guard in this system has been mutation-tested — fourteen mutations, each
caught by the rule that should catch it. A guard nobody has broken on purpose
is a guard nobody should cite.
