import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { motion } from "@/constants/motion";
import { useMotion } from "@/context/MotionContext";
import { useColors } from "@/hooks/useColors";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type MotionPressableProps = Omit<PressableProps, "style" | "children"> & {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle | TextStyle | ImageStyle>;
  pressScale?: number;
  success?: boolean;
  /** Kept for drop-in compatibility with existing TouchableOpacity usage. */
  activeOpacity?: number;
};

/** Consistent, immediate press feedback that preserves accessibility semantics. */
export function MotionPressable({
  children,
  style,
  pressScale = motion.scale.press,
  success,
  activeOpacity: _activeOpacity,
  onPressIn,
  onPressOut,
  disabled,
  ...props
}: MotionPressableProps) {
  const { reduceMotion } = useMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const previousSuccess = useRef(success);

  const animateTo = (value: number, duration = motion.duration.fast) => {
    scale.stopAnimation();
    if (reduceMotion) {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, {
      toValue: value,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    if (reduceMotion) scale.stopAnimation(() => scale.setValue(1));
    if (success && !previousSuccess.current && !reduceMotion) {
      Animated.sequence([
        Animated.timing(scale, {
          toValue: motion.scale.success,
          duration: motion.duration.fast,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 5,
          tension: 140,
          useNativeDriver: true,
        }),
      ]).start();
    }
    previousSuccess.current = success;
  }, [reduceMotion, scale, success]);

  useEffect(() => () => scale.stopAnimation(), [scale]);

  return (
    <AnimatedPressable
        {...props}
        disabled={disabled}
        // React Native's Animated wrapper loses Pressable's callback-style
        // typing, although this is supported at runtime on native and web.
        style={
          (({ pressed }: PressableStateCallbackType) => [
            style,
            {
              opacity: pressed && !disabled ? motion.opacity.pressed : 1,
              transform: [{ scale }],
            },
          ]) as never
        }
        onPressIn={(event) => {
          animateTo(pressScale);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          animateTo(1);
          onPressOut?.(event);
        }}
    >
      {children}
    </AnimatedPressable>
  );
}

/** A one-shot content entrance for screen-level or section-level state changes. */
export function FadeIn({
  children,
  style,
  delay = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const { reduceMotion } = useMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : 8)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.duration.normal,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: motion.duration.normal,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, opacity, reduceMotion, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

/** Theme-aware skeleton with a single conservative pulse, stopped on unmount. */
export function SkeletonBlock({ style }: { style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const { reduceMotion } = useMotion();
  const opacity = useRef(new Animated.Value(motion.opacity.skeletonMin)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(motion.opacity.skeletonMax);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: motion.opacity.skeletonMax, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: motion.opacity.skeletonMin, duration: 700, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);

  return <Animated.View style={[style, { opacity, backgroundColor: `${colors.mutedForeground}30` }]} />;
}

/** Announces a completed action without relying on movement alone. */
export function SuccessFeedback({ message }: { message: string }) {
  const colors = useColors();
  return (
    <FadeIn style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${colors.success}20`,
        }}
      >
        <Text style={{ color: colors.success, fontFamily: "PlusJakartaSans_700Bold" }}>✓</Text>
      </View>
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: colors.success, fontFamily: "PlusJakartaSans_500Medium", fontSize: 13 }}
      >
        {message}
      </Text>
    </FadeIn>
  );
}