/**
 * Semantic colour roles — platform-free, so the rules are unit-testable.
 *
 * Lives beside `shape.ts` and for the same reason: `theme.ts` imports
 * `Platform` as a *value*, which drags the React Native runtime into any node
 * test that touches it. `@/theme` re-exports everything here so screens keep
 * one import.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 *
 * Daylight Cartography is a *brand* palette: `pulseGreen`, `moveGold` and
 * `heatCoral` are tuned to be vivid on a white page. Vivid and legible are
 * different jobs, and text set in the brand hue is not legible:
 *
 *     pulseGreen #18C987 on white → 2.16:1
 *     moveGold   #F7B955 on white → 1.75:1
 *     heatCoral  #FF6B4A on white → 2.82:1
 *
 * The app already knew this. Every screen that needed to *write* something in
 * a brand colour reached for a darker hand-mixed variant — `#0A8F60` for
 * green, `#B07908` for gold, `#C2492E` for coral — and those three literals
 * had been pasted into some eighty call sites across twenty-eight files. The
 * pale fills behind them went the same way: three different greens
 * (`#C9EEDE`, `#D9F0E5`, `#CFF6E6`) and two neutrals one hex digit apart
 * (`#E8EDF0`, `#E9ECEF`) were all doing a single job.
 *
 * A second colour system had grown underneath the first, with no name and no
 * owner. This is that system, named:
 *
 *  - **core** — the brand hue. Fills, dots, meters, progress, icons drawn on a
 *    tint. Never body text. Lives in `palette`.
 *  - **ink**  — the readable-on-light variant of the same hue. Text, glyphs,
 *    numerals.
 *  - **tints** — opaque pale fills for a *shape* (a hex cell, an emblem). Not
 *    a text background; see the note on chips below.
 *
 * ── How the ink values were chosen ────────────────────────────────────────
 *
 * Two rules, and they come from different places:
 *
 *  - **Hue is the core's.** A brand hue is not the ink's to move. Every value
 *    below sits within 0.65° of the core it belongs to.
 *  - **Saturation is the literal's.** Where the screens had already mixed an
 *    ink by hand, that saturation was a deliberate choice — `#C2492E` is a
 *    desaturated coral, not a failed attempt at `#FF6B4A` — so it is kept.
 *
 * Only lightness moves, and only as far as the floor requires:
 *
 *     green  #0A8F60 → #097D52   (hue 157.8° vs core 157.6°, sat 0.87 kept)
 *     gold   #B07908 → #9C6307   (hue  37.1° vs core  37.0°, sat 0.91 kept)
 *     coral  #C2492E → #BA462C   (hue  11.0° vs core  10.9°, sat 0.62 kept)
 *
 * The old gold literal had itself drifted 3.4° off the brand hue; correcting
 * that is why `#B07908` does not simply become a darker `#B07908`.
 *
 * ── The floor, and what it does and does not claim ────────────────────────
 *
 * Every ink clears **4.5:1 against all four surfaces the app actually writes
 * it on**: the white card, the page, and a `softTint()` chip of its own core
 * composited over each. The chip is the binding case and the one the previous
 * literals missed by the widest margin — a green chip label sat at 3.4:1.
 *
 * That is a property of these tokens, measured from the hex values by
 * `__tests__/colorTokens.test.ts`, so the floor cannot be lowered by editing a
 * comment. It is **not** a conformance claim about the app: a ratio says
 * nothing about the size text is finally rendered at, what is layered over it,
 * or what happens at large dynamic type. Those stay a device gate.
 */

/** Text, glyphs and numerals in a brand hue. See the header for derivation. */
export const ink = {
  /** Held, healthy, complete, verified. Core `#18C987`. */
  green: "#097D52",
  /** In progress, caution, XP and reward numerals. Core `#F7B955`. */
  gold: "#9C6307",
  /** Contested, at risk, falling. Core `#FF6B4A`. */
  coral: "#BA462C",
  /** Informational and navigational emphasis. Core `#246BFE`. */
  blue: "#0A59FE",
  /** Deeds and ownership. Core `#7657FF`. */
  violet: "#6845FF",
  /**
   * Inert / dormant. `softGraphite` (#667085) one step down: body text already
   * clears the floor on the page, but on a chip it lands at 4.4:1, and a
   * neutral chip label should hold the same line as a coloured one.
   */
  neutral: "#646E83",
} as const;

/**
 * Opaque pale fills for *shapes*. (Plural, unlike `ink`, because `tint` is
 * already a local variable name on a dozen screens and a `StatCard`/`NavRow`
 * prop — an exported singular `tint` was silently shadowed on the first screen
 * that used both.)
 * — hexagon cells, emblems, row washes.
 *
 * Two steps per hue where the app draws a real distinction: a held cell and a
 * merely *eligible* one are not the same state, and collapsing them would
 * delete information rather than tidy it. One step where it did not — the two
 * neutrals differed by a single hex digit in one channel.
 *
 * These are deliberately outside the ink floor. They fill geometry, not text
 * backgrounds; a fill pale enough to carry 4.5:1 body text would be white, and
 * the territory map would lose its states. Text on a coloured ground goes on a
 * {@link softTint} chip instead, which the floor does cover.
 */
export const tints = {
  /** Held / owned. */
  green: "#C9EEDE",
  /** Eligible, candidate, previewed — deliberately weaker than `green`. */
  greenSoft: "#D9F0E5",
  /** A whole-row wash, not a chip fill (e.g. "this row is you"). */
  greenWash: "#F2FBF7",
  /** A whole-card wash for an informational or "ready" ground. */
  blueWash: "#F6FAFF",
  /** A whole-card wash for a safety or caution ground. */
  coralWash: "#FFF6F3",
  /** In progress / caution. */
  gold: "#FDEFD8",
  /** Contested. */
  coral: "#FFDCD2",
  /** At risk — weaker than `coral`. */
  coralSoft: "#FFE6DE",
  /** Deed preview. */
  violet: "#E1DAFF",
  /** Informational. */
  blue: "#DCE9FF",
  /** Unclaimed, dormant, inert. */
  neutral: "#E8EDF0",
} as const;

export type InkName = keyof typeof ink;
export type TintName = keyof typeof tints;

/* ── one soft tint, one alpha ──────────────────────────────────────────────
 *
 * A component that tints an *arbitrary* caller-supplied colour cannot reach
 * for a fixed hex, so it composites that colour over the surface at low alpha.
 * A hundred and thirty-two call sites across forty-one files did this with
 * **thirteen different alphas**, from `0D` (5%) to `33` (20%) — a fourfold
 * spread, which is more than enough to make the same chip look filled on one
 * screen and empty on the next.
 *
 * Sorting them showed two populations rather than one mess, so there are three
 * named roles rather than a single flattening. The ink floor is measured
 * against {@link SOFT_TINT_ALPHA}, the one that carries text.
 *
 * The suffix is appended to a 6-digit hex, so it is only valid for one. A
 * caller passing an 8-digit colour would silently produce a 10-digit string,
 * which React Native parses as something else entirely — so anything that is
 * not `#RRGGBB` is returned untouched rather than corrupted.
 */
export const SOFT_TINT_ALPHA = "1A"; // ~10% — a chip or panel fill
export const STRONG_TINT_ALPHA = "26"; // ~15% — a selected or emphasised fill
export const HAIRLINE_ALPHA = "33"; // ~20% — a 1px border in the colour

function withAlpha(color: string, alpha: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? `${color}${alpha}` : color;
}

/** The default tinted fill: a chip, a panel, an icon bubble. */
export function softTint(color: string): string {
  return withAlpha(color, SOFT_TINT_ALPHA);
}

/** A deliberately stronger fill — a selected cell, a highlighted summary. */
export function strongTint(color: string): string {
  return withAlpha(color, STRONG_TINT_ALPHA);
}

/**
 * A 1px border in the colour.
 *
 * Genuinely a different job, not drift: a hairline covers a fraction of the
 * pixels a fill does, so at fill alpha it simply disappears. That is why the
 * border sites had all independently drifted *upwards* (`22`, `33`) while the
 * fill sites drifted *down* (`0D`–`1F`) — two populations, one missing name.
 */
export function hairline(color: string): string {
  return withAlpha(color, HAIRLINE_ALPHA);
}

/**
 * A status role, resolved to the paints a status needs.
 *
 * Seven screens and two components each declared a private version of this
 * map — `{ label, core, text, soft }` in one, `{ fill, core, text }` in the
 * next, a bare `Record<string, string>` in three more — which is how "healthy"
 * became one green on the alerts screen and a different green on the zone
 * card.
 *
 * `core` is a brand hue and belongs to `palette`, so it is injected rather
 * than duplicated here; this module owns the *pairing*, and staying free of
 * `theme.ts` is what keeps it testable on plain Node.
 */
export interface Tone {
  /** Brand hue: fills, dots, meters, icons drawn on `tint`. Not for text. */
  core: string;
  /** Readable variant: text, glyphs, numerals. */
  ink: string;
  /** The pale opaque fill for a shape in this state. */
  tint: string;
}

export type ToneName = "positive" | "caution" | "urgent" | "info" | "deed" | "neutral";

/** Build the tone table from the brand hues. */
export function buildTones(cores: Record<ToneName, string>): Record<ToneName, Tone> {
  return {
    positive: { core: cores.positive, ink: ink.green, tint: tints.green },
    caution: { core: cores.caution, ink: ink.gold, tint: tints.gold },
    urgent: { core: cores.urgent, ink: ink.coral, tint: tints.coral },
    info: { core: cores.info, ink: ink.blue, tint: tints.blue },
    deed: { core: cores.deed, ink: ink.violet, tint: tints.violet },
    neutral: { core: cores.neutral, ink: ink.neutral, tint: tints.neutral },
  };
}

/**
 * The abstract map canvas.
 *
 * The route preview, the movement screen and the club war board all draw the
 * same imaginary city — roads crossing a field of hex cells — and each drew it
 * in its own greys: `#E2E8EC` and `#E6EBEF` for the two road directions in
 * four files, `#E9EEF1` for an inert cell in two, `#E4EAED` for a loading
 * skeleton, `#E3F4EA` for a held one. They are close enough that the drift was
 * invisible in isolation and visible the moment two of these surfaces appeared
 * in the same session.
 *
 * Separate from {@link tints} on purpose: a tint carries a *state* (held,
 * contested, dormant), while these carry no meaning at all. They are the paper
 * the map is drawn on, and they must never be used to say something.
 */
export const canvas = {
  /** Horizontal roads. */
  road: "#E2E8EC",
  /** Crossing roads — one step lighter, so a junction reads as a junction. */
  roadCross: "#E6EBEF",
  /** An inert hex cell on the canvas. */
  cell: "#E9EEF1",
  /** A held hex cell on the canvas. */
  cellHeld: "#E3F4EA",
  /** Loading placeholders. */
  skeleton: "#E4EAED",
} as const;
