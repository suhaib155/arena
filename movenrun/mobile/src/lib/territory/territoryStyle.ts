/**
 * Territory relationship → map styling.
 *
 * Deliberately imports nothing from `@/theme` (which pulls in `react-native`),
 * so this module runs under plain `node --test` and can be verified offline.
 *
 * Accessibility: colour is never the only signal. Every relationship also
 * differs in fill opacity, outline width and outline dash pattern, and each one
 * carries a `label` that the legend and the a11y labels render as text.
 *
 * The palette is MovenRun's own light cream / mint / sage / lavender / peach
 * family — it is not, and must not become, INTVL's neon-on-black look.
 */

/** How a cell relates to the signed-in runner. Mirrors the backend's
 *  `TerritoryRelationship` (see backend/src/territory/rules.ts). */
export type TerritoryRelationship =
  | "mine"
  | "club"
  | "rival"
  /** Held by *somebody* — returned to an unauthenticated viewer, for whom
   *  "someone else's" is not a knowable claim (D2). */
  | "claimed"
  | "contested"
  | "neutral"
  | "protected"
  | "restricted";

export interface TerritoryStyle {
  /** Fill colour (opaque hex; opacity is applied separately by the layer). */
  fill: string;
  /** Outline colour. */
  outline: string;
  /** 0..1 fill opacity — kept low so streets and parks stay readable. */
  fillOpacity: number;
  /** Outline width in points. */
  outlineWidth: number;
  /** Dash pattern in outline-width multiples; empty array = solid line. */
  outlineDash: number[];
  /** Human-readable label — the non-colour channel. */
  label: string;
}

/**
 * The MovenRun territory palette. Each entry is distinguishable from every
 * other by at least two of { hue, fill opacity, outline width, dash pattern }.
 */
export const TERRITORY_STYLES: Record<TerritoryRelationship, TerritoryStyle> = {
  /** Soft mint green — yours. Strongest fill, solid outline. */
  mine: {
    fill: "#8FE3C2",
    outline: "#12A277",
    fillOpacity: 0.45,
    outlineWidth: 1.6,
    outlineDash: [],
    label: "Yours",
  },
  /** Deep sage green — your club's. Same family as `mine`, darker and thinner. */
  club: {
    fill: "#6E9C82",
    outline: "#3F6B54",
    fillOpacity: 0.38,
    outlineWidth: 1.4,
    outlineDash: [],
    label: "Club",
  },
  /** Soft lavender — someone else's. Solid but lighter than yours. */
  rival: {
    fill: "#C6BCF0",
    outline: "#7C6BD1",
    fillOpacity: 0.36,
    outlineWidth: 1.4,
    outlineDash: [],
    label: "Rival",
  },
  /** Muted slate — held, but by whom relative to you is unknown (signed out).
   *  Deliberately NOT the rival lavender: it must not read as "an opponent's",
   *  because it may well be your own. Dashed, to read as "sign in to see". */
  claimed: {
    fill: "#B8C2CC",
    outline: "#79868F",
    fillOpacity: 0.3,
    outlineWidth: 1.4,
    outlineDash: [3, 2],
    label: "Claimed",
  },
  /** Warm peach — defence has collapsed and the cell is up for grabs.
   *  Dashed outline so it reads as "in play" without relying on hue. */
  contested: {
    fill: "#FFC49B",
    outline: "#E2732F",
    fillOpacity: 0.44,
    outlineWidth: 2,
    outlineDash: [2, 1.5],
    label: "Contested",
  },
  /** Pale grey-green — unclaimed. Nearly transparent so the basemap dominates. */
  neutral: {
    fill: "#D7E3DA",
    outline: "#A9BCAF",
    fillOpacity: 0.16,
    outlineWidth: 1,
    outlineDash: [],
    label: "Neutral",
  },
  /** Cream tint with a deliberately heavier outline — protected from capture. */
  protected: {
    fill: "#F6EBCE",
    outline: "#C39A3C",
    fillOpacity: 0.34,
    outlineWidth: 2.6,
    outlineDash: [],
    label: "Protected",
  },
  /** Very low-opacity grey with a fine dash — not playable at all. */
  restricted: {
    fill: "#B9BEC4",
    outline: "#7A828B",
    fillOpacity: 0.12,
    outlineWidth: 1.2,
    outlineDash: [1, 1],
    label: "Restricted",
  },
};

/** Every relationship, in the order the legend should list them. */
export const TERRITORY_LEGEND_ORDER: TerritoryRelationship[] = [
  "mine",
  "club",
  "rival",
  "claimed",
  "contested",
  "neutral",
  "protected",
  "restricted",
];

const RELATIONSHIPS = new Set<string>(TERRITORY_LEGEND_ORDER);

/** Narrow an unknown API string to a relationship, defaulting to `neutral`. */
export function toRelationship(value: unknown): TerritoryRelationship {
  return typeof value === "string" && RELATIONSHIPS.has(value)
    ? (value as TerritoryRelationship)
    : "neutral";
}

export function territoryStyle(relationship: TerritoryRelationship): TerritoryStyle {
  return TERRITORY_STYLES[relationship];
}

/**
 * MapLibre `match` expressions built once from the table above, so a single
 * FillLayer / LineLayer can style every feature natively instead of mounting
 * one React component per cell (see PHASE 17 — performance).
 *
 * Shape: ["match", ["get", "relationship"], "mine", <v>, ..., <default>].
 */
function matchExpression<T>(pick: (style: TerritoryStyle) => T, fallback: T): unknown[] {
  const expression: unknown[] = ["match", ["get", "relationship"]];
  for (const relationship of TERRITORY_LEGEND_ORDER) {
    expression.push(relationship, pick(TERRITORY_STYLES[relationship]));
  }
  expression.push(fallback);
  return expression;
}

export const territoryFillColorExpression = (): unknown[] =>
  matchExpression((s) => s.fill, TERRITORY_STYLES.neutral.fill);

export const territoryFillOpacityExpression = (): unknown[] =>
  matchExpression((s) => s.fillOpacity, TERRITORY_STYLES.neutral.fillOpacity);

export const territoryOutlineColorExpression = (): unknown[] =>
  matchExpression((s) => s.outline, TERRITORY_STYLES.neutral.outline);

export const territoryOutlineWidthExpression = (): unknown[] =>
  matchExpression((s) => s.outlineWidth, TERRITORY_STYLES.neutral.outlineWidth);
