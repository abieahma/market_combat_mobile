import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { rewardForPlace } from '../game/duel';
import { useStore } from '../state/store';
import { AbieAmount, Button } from '../ui/kit';
import { radius, space, type } from '../ui/theme';
import { DuelResult } from './DuelScreen';

export type RewardState = { state: 'saving' } | { state: 'done'; amount: number } | { state: 'error' };

export function ResultScreen({
  result,
  reward,
  onRetry,
  onAgain,
  onHub,
  starting,
}: {
  result: DuelResult;
  /** The server's answer about the reward for this match. */
  reward: RewardState;
  onRetry: () => void;
  onAgain: () => void;
  onHub: () => void;
  starting: boolean;
}) {
  const { colors, t, fmt } = useStore();
  const won = result.myPlace === 1;
  const me = result.standings.find((s) => s.trader.id === 'me');

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={[type.label, { color: colors.muted }]}>{t('result.place')}</Text>
        <Text style={[styles.place, type.num, { color: won ? colors.gold : colors.text }]}>#{result.myPlace}</Text>
        <Text style={[type.display, { color: colors.text }]}>{won ? t('result.victory') : t('result.over')}</Text>
      </View>

      <View style={[styles.reward, { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}>
        <Text style={[type.label, { color: colors.gold }]}>{t('result.reward')}</Text>
        {reward.state === 'done' && <AbieAmount amount={reward.amount} size="lg" signed />}
        {reward.state === 'saving' && (
          <View style={styles.saving}>
            <ActivityIndicator color={colors.gold} />
            <Text style={[type.body, { color: colors.muted }]}>{t('net.saving')}</Text>
          </View>
        )}
        {reward.state === 'error' && (
          <View style={styles.saving}>
            <Text style={[type.body, { color: colors.down }]}>{t('net.rewardFailed')}</Text>
            <Button variant="ghost" label={t('net.retry')} onPress={onRetry} />
          </View>
        )}
      </View>

      {me && (
        <View style={styles.line}>
          <Text style={[type.body, { color: colors.muted }]}>{t('result.balance')}</Text>
          <Text style={[styles.lineValue, type.num, { color: colors.text }]}>{fmt(me.equity)}</Text>
        </View>
      )}

      <View style={[styles.table, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {result.standings.map((s, i) => {
          const isMe = s.trader.id === 'me';
          const color = s.change > 0 ? colors.up : s.change < 0 ? colors.down : colors.muted;
          return (
            <View
              key={s.trader.id}
              style={[
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
                isMe && { backgroundColor: colors.goldSoft },
              ]}
            >
              <Text style={[styles.rowPlace, type.num, { color: s.place === 1 ? colors.gold : colors.muted }]}>{s.place}</Text>
              <Text style={[styles.rowName, { color: colors.text, fontWeight: isMe ? '800' : '600' }]} numberOfLines={1}>
                {s.trader.name}
              </Text>
              <Text style={[styles.rowChange, type.num, { color }]}>
                {s.change > 0 ? '+' : ''}
                {fmt(s.change * 100, 1)}%
              </Text>
              <Text style={[styles.rowReward, type.num, { color: colors.gold }]}>+{rewardForPlace(s.place)}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Button label={t('result.again')} onPress={onAgain} big disabled={starting || reward.state === 'saving'} />
        <Button label={t('result.toHub')} onPress={onHub} variant="ghost" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingTop: space.xl * 1.5, paddingBottom: space.xl * 2 },
  hero: { alignItems: 'center', gap: space.xs },
  place: { fontSize: 88, fontWeight: '900', lineHeight: 96 },
  reward: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, alignItems: 'center', gap: space.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineValue: { fontSize: 18, fontWeight: '800' },
  table: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, height: 44 },
  rowPlace: { width: 16, fontSize: 15, fontWeight: '800' },
  rowName: { flex: 1, fontSize: 15 },
  rowChange: { fontSize: 14, fontWeight: '700' },
  rowReward: { width: 40, textAlign: 'right', fontSize: 14, fontWeight: '800' },
  actions: { gap: space.md, marginTop: space.sm },
  saving: { alignItems: 'center', gap: space.sm },
});
