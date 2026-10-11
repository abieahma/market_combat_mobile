// Building blocks of the night-boutique look: the backdrop with warm light,
// smoked-glass panels, the gold coin with a passing glint, a balance that
// counts up, and panels that lift under the finger.

import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useStore } from '../state/store';
import { radius } from './theme';

const native = Platform.OS !== 'web';

function svgId(prefix: string, raw: string) {
  return prefix + raw.replace(/[^a-zA-Z0-9]/g, '');
}

/** True when the player asked the system for less motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduced(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Near-black ground with warm light rising from below that slowly breathes. */
export function NightBackdrop() {
  const { colors, scheme } = useStore();
  const id = svgId('glow', useId());
  const reduced = useReducedMotion();
  const breath = useRef(new Animated.Value(0.75)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 5200, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(breath, { toValue: 0.62, duration: 5200, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduced]);

  const strength = scheme === 'dark' ? 0.38 : 0.3;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: breath }]}>
        <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={id} cx="50" cy="112" r="78" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colors.glow} stopOpacity={strength} />
              <Stop offset="0.45" stopColor={colors.glow} stopOpacity={strength * 0.35} />
              <Stop offset="1" stopColor={colors.glow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Smoked-glass panel with a thin gold edge and light on its top rim. */
export function Glass({ children, style, quiet }: { children: ReactNode; style?: StyleProp<ViewStyle>; quiet?: boolean }) {
  const { colors } = useStore();
  const id = svgId('sheen', useId());
  const flat = StyleSheet.flatten(style) ?? {};
  const corner = typeof flat.borderRadius === 'number' ? flat.borderRadius : radius.lg;
  return (
    // The shadow sits on an outer layer so the inner clipping does not cut it off.
    <View style={[{ borderRadius: corner }, !quiet && styles.glassShadow, flat.flex !== undefined && { flex: flat.flex }]}>
      <View style={[styles.glass, { backgroundColor: colors.glass, borderColor: quiet ? colors.line : colors.glassEdge }, style]}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.glassHighlight} stopOpacity={1} />
                <Stop offset="0.35" stopColor={colors.glassHighlight} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
          </Svg>
        </View>
        {children}
      </View>
    </View>
  );
}

/** Pressable panel that rises a little while the finger is on it. */
export function LiftPressable({
  children,
  onPress,
  disabled,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { haptic } = useStore();
  const lift = useRef(new Animated.Value(0)).current;
  const to = (v: number) => Animated.spring(lift, { toValue: v, useNativeDriver: native, speed: 28, bounciness: 6 }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
    >
      <Animated.View
        style={[
          style,
          {
            transform: [
              { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
              { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.012] }) },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

/** The ABIE coin in polished gold, with a glint passing over it now and then. */
export function ShinyCoin({ size }: { size: number }) {
  const { colors } = useStore();
  const base = useId();
  const face = svgId('face', base);
  const rim = svgId('rim', base);
  const reduced = useReducedMotion();
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(2600),
        Animated.timing(sweep, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, sweep]);

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={rim} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.goldHi} />
            <Stop offset="0.5" stopColor={colors.gold} />
            <Stop offset="1" stopColor={colors.goldLo} />
          </LinearGradient>
          <RadialGradient id={face} cx="38" cy="32" r="70" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.goldHi} />
            <Stop offset="0.55" stopColor={colors.gold} />
            <Stop offset="1" stopColor={colors.goldLo} />
          </RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill={`url(#${rim})`} />
        <Circle cx="50" cy="50" r="41" fill={`url(#${face})`} />
        <Circle cx="50" cy="50" r="41" fill="none" stroke={colors.coinInk} strokeOpacity={0.28} strokeWidth={1.2} />
        <Path d="M50 24 L69 74 H60.5 L56.6 63.4 H43.4 L39.5 74 H31 Z M46 56.2 H54 L50 45.2 Z" fill={colors.coinInk} fillOpacity={0.82} fillRule="evenodd" />
      </Svg>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glint,
          {
            width: size * 0.38,
            height: size * 1.6,
            top: -size * 0.3,
            transform: [
              { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.7, size * 1.3] }) },
              { rotate: '22deg' },
            ],
          },
        ]}
      />
    </View>
  );
}

/** Number that counts from its previous value to the new one. */
export function useCountUp(target: number, duration = 1100): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? target : 0);
  const from = useRef(reduced ? target : 0);

  useEffect(() => {
    if (reduced) {
      setShown(target);
      from.current = target;
      return;
    }
    const start = from.current;
    const t0 = Date.now();
    let frame: ReturnType<typeof requestAnimationFrame>;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (target - start) * eased);
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = target;
    };
  }, [target, duration, reduced]);

  return shown;
}

/** Gold fill used behind the main buttons. */
export function GoldFill({ rounded = radius.md }: { rounded?: number }) {
  const { colors } = useStore();
  const id = svgId('gold', useId());
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: rounded, overflow: 'hidden' }]}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.goldHi} />
            <Stop offset="0.55" stopColor={colors.gold} />
            <Stop offset="1" stopColor={colors.goldLo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  glass: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  glassShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  glint: { position: 'absolute', left: 0, backgroundColor: 'rgba(255, 255, 255, 0.38)' },
});
