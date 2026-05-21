export const colors = {
  signal: '#00FF88',
  atmosphere: '#7C3AED',
  contested: '#FF6400',
  gold: '#F59E0B',
  danger: '#EF4444',

  snow: '#F9FAFB',
  frost: '#D1D5DB',
  mist: '#6B7280',
  line: '#374151',

  void: '#07070F',
  abyss: '#0D0D0D',
  depth: '#111827',
  surface: '#1F2937',
  glass: 'rgba(13,13,13,0.75)',
  glassBorder: 'rgba(249,250,251,0.08)',
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 24,
  full: 9999,
} as const;

export const fonts = {
  display: 'ClashDisplay-Variable',
  sans: 'GeneralSans-Variable',
  mono: 'SpaceMono-Regular',
} as const;

export const textSize = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 28,
  '3xl': 32,
  '4xl': 40,
} as const;
