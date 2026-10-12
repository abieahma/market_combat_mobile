// Before a Market Kombat fight: training with the computer (free, nothing to
// win) or a fight with a player (equal stakes), and the energy boost packs.

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { KOMBAT_BOOST_PACKS, KombatBoostPackId } from '../api/contract';
import { isApiError } from '../api/transport';
import { api, requestId, useStore } from '../state/store';
import { Button } from '../ui/kit';
import { Glass, LiftPressable } from '../ui/luxe';
import { fonts, radius, space, type } from '../ui/theme';
import { Sheet } from './Sheet';

export function KombatLobby({
  visible,
  onClose,
  onTraining,
  onPvp,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onTraining: () => void;
  onPvp: () => void;
  busy: boolean;
}) {
  const { colors, t, tf, fmt, refresh, notify, haptic } = useStore();
  const [left, setLeft] = useState<number | null>(null);
  const [armed, setArmed] = useState<KombatBoostPackId | null>(null);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setArmed(null);
    api.kombat
      .boost()
      .then((b) => setLeft(b.fightsLeft))
      .catch(() => setLeft(null));
  }, [visible]);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 3500);
    return () => clearTimeout(id);
  }, [armed]);

  // The boost is very expensive, so a pack is bought on the second tap.
  const buy = async (pack: KombatBoostPackId) => {
    if (armed !== pack) {
      setArmed(pack);
      haptic('warning');
      return;
    }
    setArmed(null);
    setBuying(true);
    try {
      const res = await api.kombat.buyBoost(pack, requestId());
      setLeft(res.boost.fightsLeft);
      haptic('success');
      refresh();
    } catch (e) {
      notify(isApiError(e) && e.code === 'insufficient_funds' ? t('char.notEnough') : t('net.error'));
    } finally {
      setBuying(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: colors.text }]}>{t('kombat.title')}</Text>

      <LiftPressable onPress={onTraining} disabled={busy} accessibilityLabel={t('kombat.training')}>
        <Glass style={styles.option}>
          <Text style={[styles.optionTitle, { color: colors.text }]}>{t('kombat.training')}</Text>
          <Text style={[type.body, { color: colors.muted }]}>{t('kombat.trainingNote')}</Text>
        </Glass>
      </LiftPressable>

      <LiftPressable onPress={onPvp} disabled={busy} accessibilityLabel={t('kombat.pvp')}>
        <Glass style={[styles.option, { borderColor: colors.gold }]}>
          <Text style={[styles.optionTitle, { color: colors.gold }]}>{t('kombat.pvp')}</Text>
          <Text style={[type.body, { color: colors.muted }]}>{t('kombat.pvpNote')}</Text>
        </Glass>
      </LiftPressable>

      {busy && <ActivityIndicator color={colors.gold} />}

      <View style={[styles.boost, { borderColor: colors.line }]}>
        <View style={styles.boostHead}>
          <Text style={[styles.boostTitle, { color: colors.text }]}>{t('kombat.boost')}</Text>
          {left !== null && <Text style={[styles.boostLeft, { color: colors.gold }]}>{tf('kombat.boostLeft', { n: fmt(left) })}</Text>}
        </View>
        <Text style={[styles.note, { color: colors.faint }]}>{t('kombat.boostNote')}</Text>
        <View style={styles.packs}>
          {KOMBAT_BOOST_PACKS.map((p) => (
            <Button
              key={p.id}
              variant={armed === p.id ? 'down' : 'ghost'}
              label={armed === p.id ? t('char.tapConfirm') : `${tf('kombat.boostPack', { n: p.fights })} · ${fmt(p.price)} ABIE`}
              onPress={() => buy(p.id)}
              disabled={buying}
              style={styles.pack}
            />
          ))}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36 },
  option: { padding: space.lg, gap: 4, borderRadius: radius.lg },
  optionTitle: { fontFamily: fonts.displaySemi, fontSize: 22 },
  boost: { borderTopWidth: 1, paddingTop: space.md, gap: 6 },
  boostHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  boostTitle: { fontSize: 15, fontWeight: '700' },
  boostLeft: { fontSize: 13, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 18 },
  packs: { gap: space.sm, marginTop: 4 },
  pack: { minHeight: 44 },
});
