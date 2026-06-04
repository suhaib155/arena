/**
 * MovenRun design tokens. Dark, energetic, quest-game feel.
 * Centralized so screens/components stay visually consistent.
 */
export const colors = {
  bg: "#0B0B12",
  surface: "#15151F",
  surfaceAlt: "#1E1E2C",
  border: "#2A2A3A",
  primary: "#7C5CFF",
  primaryDim: "#3A2E73",
  accent: "#36E2A0",
  danger: "#FF6B6B",
  warning: "#FFC56B",
  text: "#F5F5FA",
  textDim: "#9A9AB0",
  textFaint: "#6A6A80",
} as const;

export const categoryColor: Record<string, string> = {
  Cardio: "#FF6B8B",
  Mobility: "#36E2A0",
  Strength: "#FFC56B",
  Mindful: "#7C5CFF",
};

export const difficultyColor: Record<string, string> = {
  Easy: "#36E2A0",
  Medium: "#FFC56B",
  Hard: "#FF6B6B",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
} as const;
