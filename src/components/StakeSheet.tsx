// Stake before a match of a game with its own currency: the player picks how
// many ABIE to turn into the game currency at the game's fixed rate.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ShownGame } from '../games';
import { useStore } from '../state/store';
import { Button } from '../ui/kit';
import { fonts, radius, space, type } from '../ui/theme';
import { Sheet } from './Sheet';

/** "1 ABIE = $100" for a game's rate. */
export function rateText(game: ShownGame, fmt: (v: number) => string): string {
  const rate = game.entry?.currency?.rate;
  return rate ? `${fmt(rate.abie)} ABIE = ${game.info.currencySign}${fmt(rate.units)}` : '';
}

export function StakeSheet({
  game,
  onClose,
  onConfirm,
  busy,
}: {
  /** Game to stake on; null hides the sheet. */
  game: ShownGame | null;
  onClose: () => void;
  onConfirm: (lots: number) => void;
  busy: boolean;
}) {
  const { colors, t, tf, fmt, balance, haptic } = useStore();
  const rate = game?.entry?.currency?.rate ?? null;
  const stakes = game?.info.stakes ?? [];
  const affordable = rate ? stakes.filter((lots) => lots * rate.abie <= balance) : [];
  const [lots, setLots] = useState<number | null>(null);

  // Each time the sheet opens: 10 ABIE if possible, otherwise the largest stake the balance allows.
  useEffect(() => {
    if (!game || !rate) return;
    const preferred = stakes.find((l) => l * rate.abie === 10 && l * rate.abie <= balance);
    setLots(preferred ?? affordable[affordable.length - 1] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.info.id, !!game]);

  if (!game) return null;
  const sign = game.info.currencySign;

  return (
    <Sheet visible={!!game} onClose={onClose}>
      <Text style={[styles.title, { color: colors.text }]}>{t('stake.title')}</Text>
      <Text style={[type.body, { color: colors.muted }]}>{t('stake.text')}</Text>

      <View style={[styles.rateRow, { borderColor: colors.line }]}>
        <Text style={[styles.rateLabel, { color: colors.muted }]}>{t('stake.rate')}</Text>
        <Text style={[styles.rateValue, { color: colors.gold }]}>{rateText(game, fmt)}</Text>
      </View>

      <View style={styles.chips}>
        {rate &&
          stakes.map((l) => {
            const abie = l * rate.abie;
            const can = abie <= balance;
            const active = l === lots;
            return (
              <Pressable
                key={l}
                accessibilityRole="button"
                accessibilityState={{ selected: active, disabled: !can }}
                accessibilityLabel={`${fmt(abie)} ABIE`}
                disabled={!can}
                onPress={() => {
                  haptic('tap');
                  setLots(l);
                }}
                style={[
                  styles.chip,
                  { borderColor: active ? colors.gold : colors.line, backgroundColor: active ? colors.goldSoft : 'transparent', opacity: can ? 1 : 0.35 },
                ]}
              >
                <Text style={[styles.chipAbie, { color: colors.text }]}>{fmt(abie)}</Text>
                <Text style={[styles.chipTicker, { color: colors.gold }]}>ABIE</Text>
                <Text style={[styles.chipUnits, { color: colors.muted }]}>
                  {sign}
                  {fmt(l * rate.units)}
                </Text>
              </Pressable>
            );
          })}
      </View>

      <Text style={[styles.balance, { color: affordable.length ? colors.faint : colors.down }]}>
        {affordable.length ? tf('char.yourBalance', { amount: `${fmt(balance)} ABIE` }) : t('stake.notEnough')}
      </Text>

      <Button label={t('stake.play')} onPress={() => lots && onConfirm(lots)} big disabled={busy || !lots || !affordable.includes(lots)} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34 },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: space.sm },
  rateLabel: { fontSize: 13 },
  rateValue: { fontFamily: fonts.displaySemi, fontSize: 20, fontVariant: ['lining-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minWidth: 92, flexGrow: 1, borderWidth: 1, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center' },
  chipAbie: { fontFamily: fonts.display, fontSize: 26, lineHeight: 28, fontVariant: ['lining-nums'] },
  chipTicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  chipUnits: { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  balance: { fontSize: 13, textAlign: 'center' },
});
