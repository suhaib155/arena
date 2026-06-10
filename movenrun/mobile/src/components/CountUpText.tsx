import { useEffect, useRef, useState } from "react";
import { Text, type TextStyle } from "react-native";
import { motion } from "@/theme";

interface CountUpTextProps {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  /** Render with fixed decimal places (e.g. km). Defaults to whole numbers. */
  decimals?: number;
  style?: TextStyle | TextStyle[];
}

/**
 * Counts from 0 up to `value` with an ease-out curve — the small reward
 * satisfaction moment, with zero animation dependencies. Renders the final
 * value immediately if it is 0 or the component re-targets mid-flight.
 */
export function CountUpText({
  value,
  prefix = "",
  suffix = "",
  duration = motion.slow,
  decimals = 0,
  style,
}: CountUpTextProps) {
  const [shown, setShown] = useState(0);
  const raf = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [value, duration]);

  return (
    <Text style={style}>
      {prefix}
      {decimals > 0 ? shown.toFixed(decimals) : Math.round(shown).toLocaleString()}
      {suffix}
    </Text>
  );
}
