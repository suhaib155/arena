/**
 * MovenRun design tokens — “Warm Cartography”.
 *
 * A warm sand-cream canvas with ivory cards, deep forest green as the brand
 * lead, a warm near-black for hero surfaces and the tab bar, and soft tinted
 * badges (sage, peach, sky, lilac, sand). Shadows are warm-tinted, because a
 * cool navy shadow reads as dirt over cream.
 *
 * Every token name is preserved across theme generations, so existing call
 * sites keep compiling and inherit the retone automatically.
 */
import { Platform, type TextStyle, type ViewStyle } from "react-native";

/** The raw Warm Cartography palette. Prefer the semantic `colors` map in
 *  screens; reach for the palette when a token is brand-specific (hex zone
 *  states, Locked MOVE gold, Deed violet, …). */
export const palette = {
  /* Canvas — a warm sand cream rather than a cool white. This is what gives
     the whole app its calm, editorial feel; cards then sit on it as ivory. */
  morningWhite: "#F0E9DE",
  cloudCard: "#FCF9F3",
  mistPanel: "#EAE2D5",
  paleSky: "#DCEDE0",

  /* Ink — a warm near-black. Pure black is harsh against cream. */
  deepInk: "#171613",
  midnight: "#262420",
  softGraphite: "#6B6459",
  silverTrail: "#A79E90",
  dustGray: "#D8CFC0",

  /* Brand — deep forest green leads, with warm clay and amber supporting.
     `baseBlue` stays a real blue: it denotes the Base chain on the Network
     screen and must not silently become green. */
  forest: "#1E4D3A",
  forestSoft: "#3A7A5C",
  pulseGreen: "#2F7A55",
  voltMint: "#8FD9A8",
  heatCoral: "#DE7440",
  moveGold: "#D9A03C",
  deedViolet: "#6F5FA8",
  rivalRed: "#C9524C",
  baseBlue: "#2F6BD8",
  skyBlue: "#5A8FD6",
} as const;

/** Semantic colors. Key names are stable across theme generations so all
 *  existing call sites keep compiling. */
export const colors = {
  bg: palette.morningWhite,
  surface: palette.cloudCard,
  surfaceAlt: palette.mistPanel,
  /** Hairline card edge — gives cards a crisp boundary instead of a fuzzy blur. */
  border: "#E2D9C9",
  /** Ink surface for hero moments (deep card behind light type). */
  ink: palette.deepInk,
  inkSoft: palette.midnight,
  primary: palette.forest,
  primaryDim: palette.paleSky,
  accent: palette.pulseGreen,
  danger: palette.rivalRed,
  warning: palette.moveGold,
  text: palette.deepInk,
  textDim: palette.softGraphite,
  textFaint: palette.silverTrail,
  /** Type colours for use on ink/gradient surfaces. */
  onInk: "#FFFFFF",
  onInkDim: "#B5AFA3",
} as const;

/**
 * Soft tinted card surfaces.
 *
 * A screen of identical white cards reads as a template no matter how good the
 * type is. Giving each card a faint wash keyed to its meaning — streak warm,
 * territory green, progress blue — creates rhythm and warmth while keeping the
 * canvas warm. `bg` is the surface, `edge` its hairline, `ink` the accent used
 * for the value and icon (all `ink` values clear 4.5:1 on their own `bg`).
 */
export const tints = {
  lilac: { bg: "#E7E1F4", edge: "#D7CEEC", ink: "#544590" },
  mint: { bg: "#DCEDE0", edge: "#C7E0CE", ink: "#1D5A3E" },
  peach: { bg: "#F9E4CE", edge: "#F1D4B6", ink: "#A3571F" },
  sky: { bg: "#DBE8F4", edge: "#C7DAEC", ink: "#2A5478" },
  sand: { bg: "#F5EAD2", edge: "#EADCB9", ink: "#856520" },
  slate: { bg: "#E9E2D6", edge: "#DAD1C1", ink: "#4A443A" },
} as const;

export type TintName = keyof typeof tints;

/** Hex-zone state colors, shared by the territory preview + the future map. */
export const zoneColors = {
  owned: palette.pulseGreen,
  contested: palette.heatCoral,
  deed: palette.deedViolet,
  unclaimed: palette.dustGray,
} as const;

export const categoryColor: Record<string, string> = {
  Cardio: palette.heatCoral,
  Mobility: palette.pulseGreen,
  Strength: palette.moveGold,
  Mindful: palette.deedViolet,
};

export const difficultyColor: Record<string, string> = {
  Easy: palette.pulseGreen,
  Medium: palette.moveGold,
  Hard: palette.heatCoral,
};

/**
 * Gradient endpoint pairs, rendered by `components/Gradient` as stacked solid
 * bands (no native gradient dependency). Use sparingly — the forest ramp is the
 * app's signature, so it belongs on the primary action and hero surfaces only.
 */
export const gradients = {
  /** The signature: deep forest → soft forest. Primary CTAs, Move button. */
  aurora: [palette.forest, palette.forestSoft],
  /** Alias kept for existing call sites. */
  cta: [palette.forest, palette.forestSoft],
  /** Deep hero surface — warm near-black with a lift toward midnight. */
  ink: [palette.deepInk, palette.midnight],
  /** Progress / XP fills. */
  xp: [palette.pulseGreen, palette.voltMint],
  /** Reward and streak moments. */
  reward: [palette.moveGold, palette.heatCoral],
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Generous, modern corner radii — the single cheapest premium signal. */
export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  pill: 999,
} as const;

/**
 * Layered shadows tinted warm rather than neutral black. A warm shadow reads as
 * light falling across cream; a cool one reads as dirt. Spread onto a view
 * style: `{ ...shadows.card }`.
 */
export const shadows = {
  /** Subtle lift for secondary chips and inline panels. */
  soft: {
    shadowColor: "#4A3F2E",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  } satisfies ViewStyle,
  /** Resting card. */
  card: {
    shadowColor: "#4A3F2E",
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  } satisfies ViewStyle,
  /** Floating elements: tab bar, hero card, footers. */
  float: {
    shadowColor: "#43392A",
    shadowOpacity: 0.16,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 9,
  } satisfies ViewStyle,
  /** Deep hero surfaces that need to feel anchored and expensive. */
  hero: {
    shadowColor: "#241E15",
    shadowOpacity: 0.28,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 20 },
    elevation: 14,
  } satisfies ViewStyle,
} as const;

/** Colored glow for primary CTAs and reward moments. */
export function glow(color: string): ViewStyle {
  return {
    shadowColor: color,
    shadowOpacity: 0.42,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  };
}

/**
 * Hairline edge that makes a light card crisp against the canvas. 1dp reads as
 * a true hairline on every density we ship to, and unlike
 * `StyleSheet.hairlineWidth` it never rounds away to nothing.
 */
export const hairline = {
  borderWidth: 1,
  borderColor: colors.border,
} satisfies ViewStyle;

/**
 * Typography scale.
 *
 * Target faces are Sora (display), Plus Jakarta Sans (body) and Space Grotesk
 * (numeric/technical) to match the website. Shipping the font packages is a
 * deliberate follow-up PR (`expo-font` + `@expo-google-fonts/*`); until then
 * the platform sans serves with matched sizes/weights/tracking so the scale —
 * and every call site — is already locked in.
 */
export const type = {
  /** Hero numerals and wordmark moments. (Sora target) */
  display: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.1,
    color: colors.text,
  } satisfies TextStyle,
  /** Screen titles. (Sora target) */
  title: {
    fontSize: 23,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: colors.text,
  } satisfies TextStyle,
  /** Card titles / section headings. */
  heading: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
    color: colors.text,
  } satisfies TextStyle,
  /** Body copy. (Plus Jakarta Sans target) */
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textDim,
  } satisfies TextStyle,
  /** Supporting captions and labels. */
  caption: {
    fontSize: 12.5,
    color: colors.textDim,
  } satisfies TextStyle,
  /** Tiny uppercase kickers. */
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.textFaint,
  } satisfies TextStyle,
  /** Route stats, coordinates, counts. (Space Grotesk target) */
  mono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 13,
    letterSpacing: 0.2,
    color: colors.textDim,
  } satisfies TextStyle,
} as const;

/** Animation timing tokens. Springy and premium — nothing should snap. */
export const motion = {
  /** Press feedback. */
  fast: 120,
  /** Card entrances. */
  base: 300,
  /** Reward / celebration moments. */
  slow: 700,
  /** Soft-overshoot spring for pops and presses (Animated.spring config). */
  spring: { friction: 7, tension: 65, useNativeDriver: true },
} as const;
