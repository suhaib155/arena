import { useWindowDimensions } from "react-native";
import { fs, isCompact, isTiny, vh } from "@/lib/responsive";

export interface Responsive {
  width: number;
  height: number;
  /** Short viewport — trim decorative height and hero type. */
  compact: boolean;
  /** Very short viewport — trim harder. */
  tiny: boolean;
  /** Viewport-relative dimension, clamped to [min, max]. */
  vh: (fraction: number, min: number, max: number) => number;
  /** Type size scaled down (never up) for the current viewport. */
  fs: (size: number, floor?: number) => number;
}

/**
 * Live viewport-aware sizing. Backed by `useWindowDimensions`, so it re-renders
 * on rotation, split-screen and font-scale changes rather than baking in the
 * dimensions at mount.
 */
export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    compact: isCompact(height),
    tiny: isTiny(height),
    vh: (fraction, min, max) => vh(height, fraction, min, max),
    fs: (size, floor) => fs(size, height, floor),
  };
}
