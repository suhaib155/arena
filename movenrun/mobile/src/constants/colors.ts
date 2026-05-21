export const COLORS = {
  abyss:      '#080b12',
  slate:      '#131a24',
  slateHi:    '#1e2a38',
  atmosphere: '#0d1f30',
  line:       '#2a3545',
  frost:      '#7eb8d4',
  mist:       '#7a8fa6',
  signal:     '#00ff88',
  enemy:      '#ff3355',
  violet:     '#8b5cf6',
  ember:      '#ff6a00',
  gold:       '#ffd700',
  darkGreen:  '#0a1912',
} as const;

export type ColorKey = keyof typeof COLORS;
