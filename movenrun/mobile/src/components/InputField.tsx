import React, { useCallback, useRef, useState } from 'react';
import {
  TextInput,
  StyleSheet,
  TextInputProps,
  View,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';
import { timingEnter, timingExit } from '../theme/animations';

interface Props extends TextInputProps {
  label: string;
}

export function InputField({ label, style, onFocus, onBlur, ...rest }: Props) {
  const focused = useSharedValue(0);
  const labelProgress = useSharedValue(rest.value ? 1 : 0);

  const handleFocus = useCallback(
    (e: any) => {
      focused.value = withTiming(1, timingEnter);
      labelProgress.value = withTiming(1, timingEnter);
      onFocus?.(e);
    },
    [focused, labelProgress, onFocus],
  );

  const handleBlur = useCallback(
    (e: any) => {
      focused.value = withTiming(0, timingExit);
      if (!rest.value) {
        labelProgress.value = withTiming(0, timingExit);
      }
      onBlur?.(e);
    },
    [focused, labelProgress, onBlur, rest.value],
  );

  const containerStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focused.value,
      [0, 1],
      [colors.line, colors.signal],
    ),
    shadowColor: colors.signal,
    shadowOpacity: focused.value * 0.25,
    shadowRadius: focused.value * 12,
    shadowOffset: { width: 0, height: 0 },
  }));

  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(labelProgress.value * -22, timingEnter),
      },
      {
        scale: withTiming(labelProgress.value === 1 ? 0.8 : 1, timingEnter),
      },
    ],
    color: interpolateColor(
      focused.value,
      [0, 1],
      [colors.mist, colors.signal],
    ),
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <Animated.Text style={[styles.label, labelStyle]}>{label}</Animated.Text>
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={colors.mist}
        onFocus={handleFocus}
        onBlur={handleBlur}
        cursorColor={colors.signal}
        selectionColor={`${colors.signal}55`}
        {...rest}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingTop: space[5],
    paddingHorizontal: space[4],
    paddingBottom: space[3],
    backgroundColor: colors.depth,
    // elevation for Android glow effect
    elevation: 0,
  },
  label: {
    position: 'absolute',
    left: space[4],
    top: space[4],
    fontSize: textSize.base,
    fontFamily: fonts.sans,
    transformOrigin: 'left center',
  } as any,
  input: {
    color: colors.snow,
    fontSize: textSize.md,
    fontFamily: fonts.sans,
    paddingTop: 0,
    minHeight: 28,
  },
});
