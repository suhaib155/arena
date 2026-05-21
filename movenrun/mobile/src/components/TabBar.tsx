import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  interpolateColor,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius, space, textSize } from '../theme/tokens';
import { springSnappy, timingReduceMotion, timingStandard } from '../theme/animations';

export type TabKey = 'map' | 'earn' | 'run' | 'battles' | 'profile';

interface Tab {
  key: TabKey;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { key: 'map', label: 'Map', icon: '⬡' },
  { key: 'earn', label: 'Earn', icon: '◆' },
  { key: 'run', label: 'Run', icon: '▶' },
  { key: 'battles', label: 'Battles', icon: '⚔' },
  { key: 'profile', label: 'Profile', icon: '◉' },
];

// Tab indices excluding the center "run" tab
const SIDE_TABS = TABS.filter((t) => t.key !== 'run');

interface Props {
  activeTab: TabKey;
  onTabPress: (key: TabKey) => void;
  isRunning?: boolean;
}

function TabItem({
  tab,
  isActive,
  onPress,
}: {
  tab: Tab;
  isActive: boolean;
  onPress: () => void;
}) {
  const progress = useSharedValue(isActive ? 1 : 0);
  const dotOpacity = useSharedValue(isActive ? 1 : 0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((rm: boolean) => {
      progress.value = rm
        ? withTiming(isActive ? 1 : 0, timingReduceMotion)
        : withSpring(isActive ? 1 : 0, springSnappy);
      dotOpacity.value = rm
        ? withTiming(isActive ? 1 : 0, timingReduceMotion)
        : withSpring(isActive ? 1 : 0, springSnappy);
    });
  }, [isActive, progress, dotOpacity]);

  const iconStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.mist, colors.signal]),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    maxHeight: progress.value * 16,
    marginTop: progress.value * 2,
  }));

  const dotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
    transform: [{ scale: dotOpacity.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      style={styles.tabItem}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <Animated.Text style={[styles.tabIcon, iconStyle]}>{tab.icon}</Animated.Text>
      <Animated.Text style={[styles.tabLabel, labelStyle]}>{tab.label}</Animated.Text>
      <Animated.View style={[styles.activeDot, dotStyle]} />
    </Pressable>
  );
}

function RunButton({ onPress, isRunning }: { onPress: () => void; isRunning: boolean }) {
  const breathe = useSharedValue(0.6);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((rm: boolean) => {
      if (rm) {
        breathe.value = 0.6;
        return;
      }
      breathe.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200 }),
          withTiming(0.6, { duration: 1200 }),
        ),
        -1,
        true,
      );
    });
  }, [breathe]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: breathe.value * 0.5,
    transform: [{ scale: 0.85 + breathe.value * 0.25 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      style={styles.runButtonWrapper}
      accessibilityRole="button"
      accessibilityLabel={isRunning ? 'Stop run' : 'Start run'}
    >
      {/* Breathing glow behind button */}
      <Animated.View style={[styles.runGlow, glowStyle]} />
      <View style={[styles.runButton, isRunning && styles.runButtonActive]}>
        <Text style={styles.runIcon}>{isRunning ? '■' : '▶'}</Text>
      </View>
    </Pressable>
  );
}

export function TabBar({ activeTab, onTabPress, isRunning = false }: Props) {
  const handleTabPress = useCallback(
    (key: TabKey) => {
      Haptics.selectionAsync();
      onTabPress(key);
    },
    [onTabPress],
  );

  const leftTabs = TABS.slice(0, 2);
  const rightTabs = TABS.slice(3);

  return (
    <View style={styles.container} pointerEvents="box-none">
      <BlurView intensity={24} tint="dark" style={styles.blur}>
        <View style={styles.inner}>
          {/* Left side tabs */}
          {leftTabs.map((tab) => (
            <TabItem
              key={tab.key}
              tab={tab}
              isActive={activeTab === tab.key}
              onPress={() => handleTabPress(tab.key)}
            />
          ))}

          {/* Center run button raised above */}
          <RunButton
            onPress={() => handleTabPress('run')}
            isRunning={isRunning}
          />

          {/* Right side tabs */}
          {rightTabs.map((tab) => (
            <TabItem
              key={tab.key}
              tab={tab}
              isActive={activeTab === tab.key}
              onPress={() => handleTabPress(tab.key)}
            />
          ))}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 28,
    left: 16,
    right: 16,
    borderRadius: radius.lg,
    overflow: 'hidden',
    // Shadow for the floating pill
    shadowColor: colors.void,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 16,
  },
  blur: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 68,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[1],
    minHeight: 44,
    minWidth: 44,
  },
  tabIcon: {
    fontSize: 20,
  },
  tabLabel: {
    fontFamily: fonts.sans,
    fontSize: textSize.xs,
    color: colors.signal,
    overflow: 'hidden',
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.signal,
    marginTop: 3,
    shadowColor: colors.signal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  // Run button
  runButtonWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    minHeight: 44,
    minWidth: 44,
  },
  runGlow: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.signal,
  },
  runButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    // signal → atmosphere gradient approximated with a solid + overlay
    backgroundColor: colors.signal,
    shadowColor: colors.signal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  runButtonActive: {
    backgroundColor: colors.danger,
    shadowColor: colors.danger,
  },
  runIcon: {
    fontSize: 18,
    color: colors.void,
    fontWeight: '700',
  },
});
