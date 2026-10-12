import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MatchFinished } from '../api/contract';
import { useStore } from '../state/store';
import { AbieAmount, Button } from '../ui/kit';
import { fonts, radius, space, type } from '../ui/theme';
import { DuelResult } from './DuelScreen';

/** The server's settlement of the match: what went back to ABIE. */
export type SettleState = { state: 'saving' } | { state: 'done'; res: MatchFinished } | { state: 'error' };

export function ResultScreen({
  result,
  settle,
  money: show,
  onRetry,
  onAgain,
  onHub,
  starting,
}: {
  result: DuelResult;
  settle: SettleState;
  /** Shows an amount of the game currency: $1,000. */
  money: (formatted: string) => string;
  onRetry: () => void;
  onAgain: () => void;
  onHub: () => void;
  starting: boolean;
}) {
  const { colors, t, fmt } = useStore();
  const won = result.myPlace === 1;
  const money = (v: number, signed = false) => `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}${show(fmt(Math.abs(v)))}`;
  const res = settle.state === 'done' ? settle.res : null;
  const pnl = result.equity - result.stake;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Text style={[type.label, { color: colors.muted }]}>{t('result.place')}</Text>
        <Text style={[styles.place, type.num, { color: won ? colors.gold : colors.text }]}>#{result.myPlace}</Text>
        <Text style={[type.display, { color: colors.text }]}>{won ? t('result.victory') : t('result.over')}</Text>
      </View>

      <View style={[styles.settle, { backgroundColor: colors.goldSoft, borderColor: colors.gold }]}>
        <Text style={[type.label, { color: colors.gold }]}>{t('result.returned')}</Text>
        {res && (
          <>
            <AbieAmount amount={res.payout} size="lg" />
            <Text style={[styles.net, { color: res.net > 0 ? colors.up : res.net < 0 ? colors.down : colors.muted }]}>
              {t('result.net')}: {res.net > 0 ? '+' : res.net < 0 ? '−' : ''}
              {fmt(Math.abs(res.net))} ABIE
            </Text>
          </>
        )}
        {settle.state === 'saving' && (
          <View style={styles.saving}>
            <ActivityIndicator color={colors.gold} />
            <Text style={[type.body, { color: colors.muted }]}>{t('net.saving')}</Text>
          </View>
        )}
        {settle.state === 'error' && (
          <View style={styles.saving}>
            <Text style={[type.body, { color: colors.down, textAlign: 'center' }]}>{t('result.settleFailed')}</Text>
            <Button variant="ghost" label={t('net.retry')} onPress={onRetry} />
          </View>
        )}
      </View>

      <View style={[styles.lines, { borderColor: colors.line }]}>
        <Line label={t('result.stake')} value={money(result.stake)} />
        <Line label={t('result.final')} value={money(result.equity)} />
        <Line label={t('result.pnl')} value={money(pnl, true)} color={pnl > 0 ? colors.up : pnl < 0 ? colors.down : colors.muted} />
        {res && res.fee > 0 && <Line label={t('result.fee')} value={money(-res.fee)} color={colors.muted} />}
      </View>

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
            </View>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Button label={t('result.again')} onPress={onAgain} big disabled={starting || settle.state !== 'done'} />
        <Button label={t('result.toHub')} onPress={onHub} variant="ghost" />
      </View>
    </ScrollView>
  );
}

function Line({ label, value, color }: { label: string; value: string; color?: string }) {
  const { colors } = useStore();
  return (
    <View style={styles.line}>
      <Text style={[type.body, { color: colors.muted, flex: 1 }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: color ?? colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingTop: space.xl * 1.5, paddingBottom: space.xl * 2 },
  hero: { alignItems: 'center', gap: space.xs },
  place: { fontSize: 88, fontWeight: '900', lineHeight: 96 },
  settle: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, alignItems: 'center', gap: space.sm },
  net: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  lines: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: space.sm, gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineValue: { fontFamily: fonts.displaySemi, fontSize: 20, fontVariant: ['lining-nums'] },
  table: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, height: 44 },
  rowPlace: { width: 16, fontSize: 15, fontWeight: '800' },
  rowName: { flex: 1, fontSize: 15 },
  rowChange: { fontSize: 14, fontWeight: '700' },
  actions: { gap: space.md, marginTop: space.sm },
  saving: { alignItems: 'center', gap: space.sm },
});
