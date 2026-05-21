import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';
import { Easing } from 'react-native-reanimated';

// Standard spring — buttons, cards
export const spring: WithSpringConfig = {
  damping: 18,
  stiffness: 280,
  mass: 0.8,
};

// Snappy spring — toggles, tab indicator
export const springSnappy: WithSpringConfig = {
  damping: 20,
  stiffness: 400,
  mass: 0.7,
};

// Bouncy spring — celebrations, counter changes
export const springBouncy: WithSpringConfig = {
  damping: 12,
  stiffness: 200,
  mass: 0.9,
};

// Enter timing — overshoot spring feel
export const timingEnter: WithTimingConfig = {
  duration: 280,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
};

// Exit timing — quick pull-away
export const timingExit: WithTimingConfig = {
  duration: 200,
  easing: Easing.bezier(0.55, 0, 1, 0.45),
};

// Standard timing — smooth
export const timingStandard: WithTimingConfig = {
  duration: 240,
  easing: Easing.bezier(0.4, 0, 0.2, 1),
};

// Reduce-motion fallback: 200ms simple fade
export const timingReduceMotion: WithTimingConfig = {
  duration: 200,
  easing: Easing.linear,
};
