/**
 * MovenRun design tokens — “Aurora Cartography”.
 *
 * An evolution of Daylight Cartography: the same bright, trustworthy light
 * canvas, now with real depth (tinted layered shadows + hairline card edges),
 * a signature indigo→violet aurora used sparingly on primary moments, deep-ink
 * hero surfaces for the headline metric on a screen, and jewel-toned territory
 * accents in place of washed pastels.
 *
 * Every token name from the previous scale is preserved, so existing call sites
 * keep compiling and inherit the refresh automatically.
 */
import { Platform, type TextStyle, type ViewStyle } from "react-native";

/** The raw Aurora Cartography palette. Prefer the semantic `colors` map in
 *  screens; reach for the palette when a token is brand-specific (hex zone
 *  states, Locked MOVE gold, Deed violet, …). */
export const palette = {
  /* Surfaces — a cool porcelain canvas reads cleaner and more premium than the
     previous warm green-grey, and makes white cards actually lift off it. */
  morningWhite: "#F4F6FC",
  cloudCard: "#FFFFFF",
  mistPanel: "#EDF1FA",
  paleSky: "#E6EDFF",

  /* Ink — deep indigo-black instead of neutral slate: richer, and it ties the
     text to the brand hue instead of fighting it. */
  deepInk: "#0A0F1F",
  midnight: "#151C33",
  softGraphite: "#5A6484",
  silverTrail: "#98A2BD",
  dustGray: "#D3D9EA",

  /* Brand — electric indigo replaces the stock system blue; the greens and
     violets move from pastel to jewel tone so they hold their own on white. */
  baseBlue: "#3355FF",
  skyBlue: "#5B8DEF",
  pulseGreen: "#00C989",
  voltMint: "#4FEFB8",
  heatCoral: "#FF6A4D",
  moveGold: "#FFB43D",
  deedViolet: "#8A5CFF",
  rivalRed: "#F04452",
} as const;

/** Semantic colors. Key names are stable across theme generations so all
 *  existing call sites keep compiling. */
export const colors = {
  bg: palette.morningWhite,
  surface: palette.cloudCard,
  surfaceAlt: palette.mistPanel,
  /** Hairline card edge — gives cards a crisp boundary instead of a fuzzy blur. */
  border: "#E4E9F5",
  /** Ink surface for hero moments (deep card behind light type). */
  ink: palette.deepInk,
  inkSoft: palette.midnight,
  primary: palette.baseBlue,
  primaryDim: palette.paleSky,
  accent: palette.pulseGreen,
  danger: palette.rivalRed,
  warning: palette.moveGold,
  text: palette.deepInk,
  textDim: palette.softGraphite,
  textFaint: palette.silverTrail,
  /** Type colours for use on ink/gradient surfaces. */
  onInk: "#FFFFFF",
  onInkDim: "#A9B4D0",
} as const;

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
 * bands (no native gradient dependency). Use sparingly — the aurora is the
 * app's signature, so it belongs on the primary action and hero surfaces only.
 */
export const gradients = {
  /** The signature: electric indigo → violet. Primary CTAs, Move button. */
  aurora: [palette.baseBlue, palette.deedViolet],
  /** Alias kept for existing call sites. */
  cta: [palette.baseBlue, palette.deedViolet],
  /** Deep hero surface — near-black indigo with a lift toward midnight. */
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
 * Layered shadows tinted with the brand indigo rather than neutral black.
 * A tinted shadow reads as coloured light rather than grey dirt, which is what
 * separates a premium surface from a flat one. Spread onto a view style:
 * `{ ...shadows.card }`.
 */
export const shadows = {
  /** Subtle lift for secondary chips and inline panels. */
  soft: {
    shadowColor: "#1B2559",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  } satisfies ViewStyle,
  /** Resting card. */
  card: {
    shadowColor: "#1B2559",
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  } satisfies ViewStyle,
  /** Floating elements: tab bar, hero card, footers. */
  float: {
    shadowColor: "#141C3D",
    shadowOpacity: 0.16,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 9,
  } satisfies ViewStyle,
  /** Deep hero surfaces that need to feel anchored and expensive. */
  hero: {
    shadowColor: "#0A0F1F",
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
