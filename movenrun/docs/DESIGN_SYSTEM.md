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
| The screen header | `mobile/src/components/ScreenHeader.tsx` | `screenHeader.test.ts` |

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
