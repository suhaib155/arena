import React, { useCallback, useRef, useState } from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  RefreshControl,
  type ScrollViewProps,
} from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { COLORS } from '../../constants/design.js';

const HEX_SIZE = 18;
const INDICATOR_H = 60;

const HEX_PATH = (() => {
  const p = Skia.Path.Make();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = HEX_SIZE + HEX_SIZE * Math.cos(angle);
    const y = HEX_SIZE + HEX_SIZE * Math.sin(angle);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.close();
  return p;
})();

interface Props extends Omit<ScrollViewProps, 'refreshControl'> {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export function PullToRefreshHex({ onRefresh, children, ...scrollProps }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const hexEnd = useSharedValue(0);
  const rotation = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    indicatorOpacity.value = withTiming(1, { duration: 150 });
    hexEnd.value = withTiming(1, { duration: 350 });

    // Spin while refreshing
    rotation.value = withRepeat(
      withTiming(2 * Math.PI, { duration: 900, easing: Easing.linear }),
      -1,
      false,
    );

    try {
      await onRefresh();
    } finally {
      // Stop spinning, dissolve
      rotation.value = withSpring(0, { damping: 12, stiffness: 120 });
      hexEnd.value = withTiming(0, { duration: 300 });
      indicatorOpacity.value = withTiming(0, { duration: 300 });
      setRefreshing(false);
    }
  }, [onRefresh, hexEnd, rotation, indicatorOpacity]);

  const spinTransform = useDerivedValue(() => [
    { translateX: HEX_SIZE },
    { translateY: HEX_SIZE },
    { rotate: rotation.value },
    { translateX: -HEX_SIZE },
    { translateY: -HEX_SIZE },
  ]);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.value,
  }));

  return (
    <View style={styles.container}>
      {/* Custom hex indicator sits above the scroll content */}
      <Animated.View style={[styles.indicator, indicatorStyle]} pointerEvents="none">
        <Canvas style={{ width: HEX_SIZE * 2, height: HEX_SIZE * 2 }}>
          <Path
            path={HEX_PATH}
            color={COLORS.signal}
            style="stroke"
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
            start={0}
            end={hexEnd}
          />
        </Canvas>
      </Animated.View>

      <ScrollView
        {...scrollProps}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="transparent"
            colors={['transparent']}
            progressBackgroundColor="transparent"
          />
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  indicator: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    zIndex: 10,
    width: HEX_SIZE * 2,
    height: HEX_SIZE * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
