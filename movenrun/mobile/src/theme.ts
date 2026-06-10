/**
 * MovenRun design tokens — “Daylight Cartography”.
 *
 * Bright white/light-mode, soft frosted-glass cards, hex-native identity and
 * vibrant territory accents (Base Blue / Pulse Green / Deed Violet). This is
 * the native counterpart of the marketing site in `movenrun/website/`.
 * Centralized so screens/components stay visually consistent.
 */
import { Platform, type TextStyle, type ViewStyle } from "react-native";

/** The raw Daylight Cartography palette. Prefer the semantic `colors` map in
 *  screens; reach for the palette when a token is brand-specific (hex zone
 *  states, Locked MOVE gold, Deed violet, …). */
export const palette = {
  morningWhite: "#F8FAF7",
  cloudCard: "#FFFFFF",
  mistPanel: "#F1F6F3",
  paleSky: "#EAF6FF",
  deepInk: "#111827",
  softGraphite: "#667085",
  silverTrail: "#A3AAB8",
  baseBlue: "#246BFE",
  pulseGreen: "#18C987",
  voltMint: "#58F2B3",
  heatCoral: "#FF6B4A",
  moveGold: "#F7B955",
  deedViolet: "#7657FF",
  rivalRed: "#EF4444",
  dustGray: "#D0D5DD",
} as const;

/** Semantic colors. Key names are kept from the previous (dark) theme so all
 *  existing call sites keep compiling; the values are Daylight Cartography. */
export const colors = {
  bg: palette.morningWhite,
  surface: palette.cloudCard,
  surfaceAlt: palette.mistPanel,
  border: "#E7ECEF",
  primary: palette.baseBlue,
  primaryDim: palette.paleSky,
  accent: palette.pulseGreen,
  danger: palette.rivalRed,
  warning: palette.moveGold,
  text: palette.deepInk,
  textDim: palette.softGraphite,
  textFaint: palette.silverTrail,
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
 * Gradient endpoint tokens. `expo-linear-gradient` is intentionally NOT a
 * dependency yet — components use the first stop as a solid fill today, and a
 * follow-up PR can switch to real gradients without retouching screens.
 */
export const gradients = {
  cta: [palette.baseBlue, palette.deedViolet],
  xp: [palette.pulseGreen, palette.voltMint],
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

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

/** Soft layered shadows (iOS) with matched Android elevation. Spread onto a
 *  view style: `{ ...shadows.card }`. */
export const shadows = {
  /** Resting glass card. */
  card: {
    shadowColor: "#101828",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  } satisfies ViewStyle,
  /** Floating elements: tab bar, hero card, footers. */
  float: {
    shadowColor: "#101828",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  } satisfies ViewStyle,
} as const;

/** Colored glow for primary CTAs and reward moments. */
export function glow(color: string): ViewStyle {
  return {
    shadowColor: color,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  };
}

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
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: colors.text,
  } satisfies TextStyle,
  /** Screen titles. (Sora target) */
  title: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.4,
    color: colors.text,
  } satisfies TextStyle,
  /** Card titles / section headings. */
  heading: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: colors.text,
  } satisfies TextStyle,
  /** Body copy. (Plus Jakarta Sans target) */
  body: {
    fontSize: 15,
    lineHeight: 21,
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
    fontWeight: "700",
    letterSpacing: 1.2,
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
