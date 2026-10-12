// Character choice. Two modes:
// - choose: the first choice, free; opened from the hub (a game or the
//   "Choose character" button) or from settings. Games open only after it.
//   Back (arrow or system button) returns to the hub without choosing.
// - change: from settings or the neutral cabinet. Moving to another universe
//   costs CHARACTER_CHANGE_COST ABIE and keeps ratings, history and ABIE.
//   From the neutral cabinet, coming back to one's own universe costs
//   UNIVERSE_RETURN_COST ABIE. Both ask for a second tap.

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CHARACTER_CHANGE_COST, CHARACTER_IDS, CharacterId, Gender, UNIVERSE_RETURN_COST } from '../api/contract';
import { isApiError } from '../api/transport';
import { Avatar } from '../components/Avatar';
import { useStore } from '../state/store';
import { AbieCoin, CheckIcon } from '../ui/icons';
import { Button, TopBar } from '../ui/kit';
import { Glass } from '../ui/luxe';
import { fonts, radius, space } from '../ui/theme';
import { characterName, CHARACTERS, worldColor } from '../world/characters';
import { useLookStyles, useType } from '../ui/look';

const GAP = 12;

export function CharacterScreen({ mode, onBack }: { mode: 'choose' | 'change'; onBack: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, tf, fmt, settings, scheme, profile, balance, chooseCharacter, changeCharacter, returnUniverse, refresh, notify, haptic } = useStore();
  const current = profile?.character ?? null;
  const outside = !!current && profile?.inUniverse === false;
  const [gender, setGender] = useState<Gender>(profile?.gender ?? 'm');
  const [picked, setPicked] = useState<CharacterId>(mode === 'change' && current ? current : 'waldberik');
  const [gridWidth, setGridWidth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  // The confirmation waits a few seconds, then the button goes back to normal.
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(id);
  }, [armed]);
  useEffect(() => setArmed(false), [picked]);

  const cardWidth = gridWidth > 0 ? (gridWidth - GAP) / 2 : 0;
  const avatarSize = Math.min(128, Math.max(64, cardWidth - 28));
  const sameAsNow = mode === 'change' && picked === current;
  // From the neutral cabinet, the own universe is a return, not a change.
  const returning = mode === 'change' && outside && sameAsNow;
  const cost = returning ? UNIVERSE_RETURN_COST : CHARACTER_CHANGE_COST;
  const shortOfAbie = balance < cost;

  const start = async () => {
    setBusy(true);
    try {
      await chooseCharacter(picked, gender);
      haptic('success');
      onBack();
    } catch (e) {
      // Already chosen on another device: take what the server has.
      if (isApiError(e) && e.code === 'conflict') {
        await refresh();
        onBack();
      } else notify(t('net.error'));
    } finally {
      setBusy(false);
    }
  };

  const change = async () => {
    if (!armed) {
      setArmed(true);
      haptic('warning');
      return;
    }
    setArmed(false);
    setBusy(true);
    try {
      if (returning) await returnUniverse();
      else await changeCharacter(picked);
      haptic('success');
      if (!returning) notify(t('char.changed'));
      onBack();
    } catch (e) {
      notify(isApiError(e) && e.code === 'insufficient_funds' ? t('char.notEnough') : t('net.error'));
    } finally {
      setBusy(false);
    }
  };

  const shownGender = mode === 'change' ? (profile?.gender ?? 'm') : gender;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {mode === 'change' ? (
        <TopBar title={outside ? t('uni.back') : t('char.change')} onBack={onBack} />
      ) : (
        <View style={styles.head}>
          <TopBar onBack={onBack} />
          <Text style={[styles.title, { color: scheme === 'dark' ? colors.goldHi : colors.gold }]}>{t('char.chooseTitle')}</Text>
          <Text style={[tp.body, { color: colors.muted }]}>{t('char.chooseSub')}</Text>
        </View>
      )}

      {mode === 'choose' && <GenderToggle value={gender} onChange={setGender} />}
      {mode === 'change' && <Text style={[tp.body, { color: colors.muted }]}>{outside ? t('uni.outside') : t('char.changeNote')}</Text>}

      <View style={styles.grid} onLayout={(e) => setGridWidth(Math.floor(e.nativeEvent.layout.width))}>
        {cardWidth > 0 &&
          CHARACTER_IDS.map((id) => {
            const active = id === picked;
            const tint = worldColor(id, scheme);
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={characterName(id, settings.lang)}
                onPress={() => {
                  haptic('tap');
                  setPicked(id);
                }}
                style={({ pressed }) => [{ width: cardWidth, transform: [{ scale: pressed ? 0.98 : active ? 1 : 0.985 }] }]}
              >
                <Glass quiet={!active} style={[styles.card, active && { borderColor: tint, borderWidth: 1.5 }]}>
                  <View style={styles.avatarWrap}>
                    <Avatar character={id} gender={shownGender} size={avatarSize} />
                    {active && (
                      <View style={[styles.tick, { backgroundColor: tint }]}>
                        <CheckIcon size={14} color={scheme === 'dark' ? '#120E0A' : '#FFFFFF'} />
                      </View>
                    )}
                  </View>
                  <Text style={[styles.name, { color: active ? tint : colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
                    {characterName(id, settings.lang)}
                  </Text>
                  <Text style={[styles.role, { color: colors.muted }]} numberOfLines={2}>
                    {t(CHARACTERS[id].text.role)}
                  </Text>
                  <View style={[styles.tag, { borderColor: id === current && mode === 'change' ? tint : colors.glassEdge }]}>
                    <Text style={[styles.tagText, { color: id === current && mode === 'change' ? tint : colors.gold }]} numberOfLines={1}>
                      {mode === 'change' && id === current ? t('char.current') : t('char.free')}
                    </Text>
                  </View>
                </Glass>
              </Pressable>
            );
          })}
      </View>

      <Glass quiet style={styles.motto}>
        <Text style={[styles.mottoText, { color: colors.text }]}>{t(CHARACTERS[picked].text.motto)}</Text>
      </Glass>

      {mode === 'choose' ? (
        <Button label={t('char.start')} onPress={start} big disabled={busy} />
      ) : (
        <View style={styles.pay}>
          <View style={styles.priceRow}>
            <Text style={[styles.priceLabel, { color: colors.muted }]}>{t('char.price')}</Text>
            <AbieCoin size={22} color={colors.coin} ink={colors.coinInk} />
            <Text style={[styles.price, { color: colors.text }]}>{fmt(cost)}</Text>
            <Text style={[styles.ticker, { color: colors.goldText }]}>ABIE</Text>
          </View>
          <Text style={[styles.balance, { color: shortOfAbie ? colors.down : colors.faint }]}>
            {tf('char.yourBalance', { amount: fmt(balance) })}
          </Text>
          <Button
            label={shortOfAbie ? t('char.notEnough') : armed ? t('char.tapConfirm') : returning ? t('uni.back') : t('char.change')}
            variant={armed ? 'down' : 'gold'}
            onPress={change}
            big
            disabled={busy || shortOfAbie || (sameAsNow && !returning)}
          />
        </View>
      )}
    </ScrollView>
  );
}

/** Man / woman switch in the look of the theme segment control. */
export function GenderToggle({ value, onChange, disabled }: { value: Gender | null; onChange: (g: Gender) => void; disabled?: boolean }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, haptic } = useStore();
  const options: { id: Gender; label: string }[] = [
    { id: 'm', label: t('char.man') },
    { id: 'f', label: t('char.woman') },
  ];
  return (
    <View style={[styles.segment, { backgroundColor: colors.glass, borderColor: colors.glassEdge, opacity: disabled ? 0.5 : 1 }]}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => {
              haptic('tap');
              onChange(o.id);
            }}
            style={[styles.segmentItem, active && { backgroundColor: colors.gold }]}
          >
            <Text style={[styles.segmentText, { color: active ? colors.goldInk : colors.text }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: space.lg, paddingBottom: space.xl * 2, gap: 20 },
  head: { gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 36, lineHeight: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  card: { alignItems: 'center', paddingHorizontal: 12, paddingTop: 14, paddingBottom: 14, gap: 6, borderRadius: radius.lg },
  avatarWrap: { marginBottom: 4 },
  tick: { position: 'absolute', right: 2, top: 2, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28 },
  role: { fontSize: 12, lineHeight: 16, textAlign: 'center', minHeight: 32 },
  tag: { marginTop: 2, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  tagText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  motto: { paddingHorizontal: 18, paddingVertical: 14 },
  mottoText: { fontFamily: fonts.displaySemi, fontSize: 20, lineHeight: 25, textAlign: 'center' },
  pay: { gap: 10 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priceLabel: { fontSize: 14, flex: 1 },
  price: { fontFamily: fonts.display, fontSize: 28, fontVariant: ['lining-nums'] },
  ticker: { fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  balance: { fontSize: 13, textAlign: 'right' },
  segment: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, padding: 4, gap: 4 },
  segmentItem: { flex: 1, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentText: { fontSize: 15, fontWeight: '700' },
});
