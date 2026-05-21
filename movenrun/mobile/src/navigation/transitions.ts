import { TransitionPresets } from '@react-navigation/stack';
import type { StackNavigationOptions } from '@react-navigation/stack';

/** Standard push screen: slide from right, underlying screen scales + dims */
export const TRANSITION_PUSH: StackNavigationOptions = {
  ...TransitionPresets.SlideFromRightIOS,
  cardStyle: { backgroundColor: 'transparent' },
  cardOverlayEnabled: true,
  cardStyleInterpolator: ({ current, next, layouts }) => {
    const translateX = current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [layouts.screen.width, 0],
    });

    const overlayOpacity = next?.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.35],
    });

    const scale = next?.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.94],
    });

    return {
      cardStyle: { transform: [{ translateX }] },
      overlayStyle: { opacity: overlayOpacity ?? 0 },
      containerStyle: next ? { transform: [{ scale: scale ?? 1 }] } : {},
    };
  },
};

/** Modal sheet: rises from bottom with backdrop dim */
export const TRANSITION_MODAL: StackNavigationOptions = {
  presentation: 'transparentModal',
  cardStyle: { backgroundColor: 'transparent' },
  cardOverlayEnabled: true,
  gestureEnabled: true,
  gestureDirection: 'vertical',
  cardStyleInterpolator: ({ current, layouts }) => {
    const translateY = current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [layouts.screen.height, 0],
    });

    const overlayOpacity = current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.6],
    });

    return {
      cardStyle: { transform: [{ translateY }] },
      overlayStyle: { opacity: overlayOpacity, backgroundColor: '#000' },
    };
  },
};

/** Tab crossfade with subtle vertical parallax (12px) */
export const TRANSITION_TAB: StackNavigationOptions = {
  cardStyleInterpolator: ({ current, next }) => {
    const opacity = current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });

    const translateY = current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [12, 0],
    });

    const exitTranslate = next?.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -12],
    });

    return {
      cardStyle: {
        opacity,
        transform: [{ translateY }],
      },
      containerStyle: next
        ? { transform: [{ translateY: exitTranslate ?? 0 }] }
        : {},
    };
  },
  transitionSpec: {
    open: { animation: 'timing', config: { duration: 220 } },
    close: { animation: 'timing', config: { duration: 220 } },
  },
};

/**
 * Zone bottom sheet: zone rises over map (map stays, dims 20%).
 * Use presentation: 'transparentModal' on the zone screen so the map
 * remains visible and just dims behind the sheet.
 */
export const TRANSITION_ZONE_SHEET: StackNavigationOptions = {
  presentation: 'transparentModal',
  cardStyle: { backgroundColor: 'transparent' },
  cardOverlayEnabled: true,
  gestureEnabled: true,
  gestureDirection: 'vertical',
  cardStyleInterpolator: ({ current, layouts }) => {
    const translateY = current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [layouts.screen.height * 0.6, 0],
    });

    const overlayOpacity = current.progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.2],
    });

    return {
      cardStyle: { transform: [{ translateY }] },
      overlayStyle: { opacity: overlayOpacity, backgroundColor: '#000' },
    };
  },
  transitionSpec: {
    open: { animation: 'spring', config: { damping: 24, stiffness: 200, mass: 1 } },
    close: { animation: 'spring', config: { damping: 30, stiffness: 250, mass: 1 } },
  },
};
