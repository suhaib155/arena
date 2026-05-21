import React, { useEffect } from 'react';
import { TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../../constants/design.js';

export type ButtonStatus = 'idle' | 'loading' | 'success' | 'error';

interface Props {
  onPress: () => void;
  status?: ButtonStatus;
  children: React.ReactNode;
  style?: ViewStyle;
  spinnerColor?: string;
}

const SPINNER_SIZE = 22;
const STROKE_W = 2.5;

// Checkmark path inside a SPINNER_SIZE × SPINNER_SIZE box
const CHECK_PATH = (() => {
  const p = Skia.Path.Make();
  p.moveTo(4, SPINNER_SIZE / 2);
  p.lineTo(SPINNER_SIZE * 0.42, SPINNER_SIZE - 5);
  p.lineTo(SPINNER_SIZE - 4, 5);
  return p;
})();

export function LoadingButton({
  onPress,
  status = 'idle',
  children,
  style,
  spinnerColor = COLORS.bg,
}: Props) {
  const rotation = useSharedValue(0);
  const checkEnd = useSharedValue(0);
  const spinOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(1);

  useEffect(() => {
    if (status === 'loading') {
      textOpacity.value = withTiming(0, { duration: 150 });
      spinOpacity.value = withTiming(1, { duration: 150 });
      rotation.value = withRepeat(
        withTiming(2 * Math.PI, { duration: 800, easing: Easing.linear }),
        -1,
        false,
      );
      checkEnd.value = 0;
    } else if (status === 'success') {
      rotation.value = withTiming(0, { duration: 200 });
      checkEnd.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      textOpacity.value = withTiming(1, { duration: 200 });
      spinOpacity.value = withTiming(0, { duration: 200 });
      checkEnd.value = withTiming(0, { duration: 150 });
      rotation.value = 0;
    }
  }, [status, rotation, checkEnd, spinOpacity, textOpacity]);

  const spinTransform = useDerivedValue(() => [
    { translateX: SPINNER_SIZE / 2 },
    { translateY: SPINNER_SIZE / 2 },
    { rotate: rotation.value },
    { translateX: -SPINNER_SIZE / 2 },
    { translateY: -SPINNER_SIZE / 2 },
  ]);

  const spinStyle = useAnimatedStyle(() => ({
    opacity: spinOpacity.value,
    position: 'absolute',
    alignSelf: 'center',
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  const isLoading = status === 'loading' || status === 'success';

  return (
    <TouchableOpacity
      style={[styles.btn, style]}
      onPress={onPress}
      disabled={isLoading}
      activeOpacity={0.85}
    >
      <Animated.Text style={[styles.text, textStyle]}>{children}</Animated.Text>

      <Animated.View style={spinStyle}>
        <Canvas style={{ width: SPINNER_SIZE, height: SPINNER_SIZE }}>
          {/* Rotating arc (spinner) */}
          {status === 'loading' && (
            <Group transform={spinTransform}>
              <Path
                path={buildArcPath(SPINNER_SIZE)}
                color={spinnerColor}
                style="stroke"
                strokeWidth={STROKE_W}
                strokeCap="round"
                start={0}
                end={0.75}
              />
            </Group>
          )}
          {/* Checkmark draws in on success */}
          {status === 'success' && (
            <Path
              path={CHECK_PATH}
              color={spinnerColor}
              style="stroke"
              strokeWidth={STROKE_W}
              strokeCap="round"
              strokeJoin="round"
              start={0}
              end={checkEnd}
            />
          )}
        </Canvas>
      </Animated.View>
    </TouchableOpacity>
  );
}

function buildArcPath(size: number) {
  const path = Skia.Path.Make();
  const r = (size - STROKE_W) / 2;
  path.addArc({ x: STROKE_W / 2, y: STROKE_W / 2, width: r * 2, height: r * 2 }, 0, 270);
  return path;
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: COLORS.signal,
    borderRadius: 32,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: COLORS.bg,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 1.2,
  },
});
