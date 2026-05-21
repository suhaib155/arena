import React, { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import { SKELETON_MS } from '../../constants/design.js';

const Ctx = createContext<SharedValue<number> | null>(null);

/**
 * Provides a single shared animation clock for all skeletons on screen.
 * Wrap each skeleton screen (not the whole app) so clocks reset per screen.
 */
export function SkeletonClockProvider({ children }: { children: ReactNode }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: SKELETON_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      progress.value = 0;
    };
  }, [progress]);

  return <Ctx.Provider value={progress}>{children}</Ctx.Provider>;
}

export function useSkeletonClock(): SharedValue<number> {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSkeletonClock must be inside SkeletonClockProvider');
  return v;
}
