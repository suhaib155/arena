import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether the OS "Reduce Motion" accessibility setting is on. Uses React
 * Native's built-in `AccessibilityInfo` (no new dependency). Movement screens
 * read this to shorten or skip decorative animation while keeping every
 * critical status shown as static text — motion is never the only signal.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduced(v);
      })
      .catch(() => {
        /* default to full motion if the query is unsupported */
      });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
