import React, { useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Canvas, RoundedRect, LinearGradient, vec } from '@shopify/react-native-skia';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  useDerivedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { COLORS } from '../../constants/design.js';
import { useSkeletonClock } from './SkeletonClock.js';

export interface SkeletonProps {
  width?: number | string;
  height: number;
  borderRadius?: number;
  variant?: 'shimmer' | 'pulse';
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height,
  borderRadius = 8,
  variant = 'shimmer',
  style,
}: SkeletonProps) {
  if (variant === 'pulse') {
    return (
      <PulseSkeleton
        width={width}
        height={height}
        borderRadius={borderRadius}
        style={style}
      />
    );
  }
  return (
    <ShimmerSkeleton
      width={width}
      height={height}
      borderRadius={borderRadius}
      style={style}
    />
  );
}

function ShimmerSkeleton({ width = '100%', height, borderRadius = 8, style }: SkeletonProps) {
  const [measuredW, setMeasuredW] = useState(typeof width === 'number' ? width : 0);
  const progress = useSkeletonClock();

  // Diagonal sweep: gradient band travels from left-of-shape to right-of-shape
  const start = useDerivedValue(() =>
    vec(-measuredW * 0.5 + progress.value * measuredW * 1.8, 0),
  );
  const end = useDerivedValue(() =>
    vec(measuredW * 0.5 + progress.value * measuredW * 1.8, height),
  );

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== measuredW) setMeasuredW(w);
  };

  return (
    <View
      style={[
        { width, height, borderRadius, overflow: 'hidden', backgroundColor: COLORS.slate },
        style,
      ]}
      onLayout={typeof width === 'string' ? handleLayout : undefined}
    >
      {measuredW > 0 && (
        <Canvas style={StyleSheet.absoluteFill}>
          <RoundedRect x={0} y={0} width={measuredW} height={height} r={borderRadius}>
            <LinearGradient
              start={start}
              end={end}
              colors={[COLORS.slate, COLORS.slateHi, COLORS.slateHi, COLORS.slate]}
              positions={[0, 0.3, 0.7, 1]}
            />
          </RoundedRect>
        </Canvas>
      )}
    </View>
  );
}

function PulseSkeleton({ width = '100%', height, borderRadius = 8, style }: SkeletonProps) {
  const opacity = useSharedValue(0.5);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 700 }),
        withTiming(0.5, { duration: 700 }),
      ),
      -1,
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, backgroundColor: COLORS.slate },
        animStyle,
        style,
      ]}
    />
  );
}
