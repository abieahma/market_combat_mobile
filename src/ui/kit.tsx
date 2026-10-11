import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useStore } from '../state/store';
import { AbieCoin, ChevronLeft } from './icons';
import { GoldFill } from './luxe';
import { fonts, radius, space, type } from './theme';

type Variant = 'gold' | 'up' | 'down' | 'ghost' | 'surface' | 'glass';

export function Button({
  label,
  onPress,
  variant = 'gold',
  icon,
  big,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: ReactNode;
  big?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, haptic } = useStore();
  const bg = {
    gold: 'transparent',
    up: colors.up,
    down: colors.down,
    ghost: 'transparent',
    surface: colors.surfaceAlt,
    glass: colors.glass,
  }[variant];
  const fg = {
    gold: colors.goldInk,
    up: colors.onSide,
    down: colors.onSide,
    ghost: colors.text,
    surface: colors.text,
    glass: colors.text,
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        (variant === 'ghost' || variant === 'glass') && { borderWidth: 1, borderColor: colors.glassEdge },
        variant === 'gold' && styles.goldShadow,
        style,
      ]}
    >
      {variant === 'gold' && <GoldFill rounded={big ? radius.lg : radius.md} />}
      {icon}
      <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function AbieAmount({ amount, size = 'md', signed }: { amount: number; size?: 'sm' | 'md' | 'lg'; signed?: boolean }) {
  const { colors, fmt } = useStore();
  const px = { sm: 14, md: 16, lg: 26 }[size];
  return (
    <View style={styles.amount}>
      <AbieCoin size={px + 2} color={colors.gold} ink={colors.coinInk} />
      <Text style={[{ fontSize: px, fontWeight: '800', color: colors.text }, type.num]}>
        {signed && amount > 0 ? '+' : ''}
        {fmt(amount)}
      </Text>
    </View>
  );
}

export function BalancePill({ onPress }: { onPress?: () => void }) {
  const { colors, balance, t, haptic } = useStore();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('wallet.title')}
      disabled={!onPress}
      onPress={() => {
        haptic('tap');
        onPress?.();
      }}
      style={({ pressed }) => [styles.pill, { backgroundColor: colors.goldSoft, borderColor: colors.gold, opacity: pressed ? 0.75 : 1 }]}
    >
      <AbieAmount amount={balance} size="sm" />
      <Text style={[styles.pillTicker, { color: colors.gold }]}>ABIE</Text>
    </Pressable>
  );
}

export function TopBar({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  const { colors, t, haptic } = useStore();
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={12}
          onPress={() => {
            haptic('tap');
            onBack();
          }}
          style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}
        >
          <ChevronLeft color={colors.text} />
        </Pressable>
      ) : null}
      {title ? (
        <Text style={[type.title, { color: colors.text, flex: 1 }]} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {right}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const { colors } = useStore();
  return <Text style={[type.label, { color: colors.muted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonBig: { minHeight: 60, borderRadius: radius.lg },
  buttonText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  buttonTextBig: { fontSize: 25, fontFamily: fonts.display, fontWeight: 'normal', letterSpacing: 0.4 },
  goldShadow: { shadowColor: '#C8862C', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  amount: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 10,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillTicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  iconButton: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
