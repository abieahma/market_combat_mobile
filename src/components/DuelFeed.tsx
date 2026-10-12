// The Chart Duel feed: who did what and when. Every trader's entries and
// exits, liquidations, headlines and the final bell, newest first.

import { StyleSheet, Text, View } from 'react-native';
import { DUEL_ME, DUEL_BOTS, DuelLogEntry, TICK_MS } from '../game/duel';
import { StringKey } from '../i18n/strings';
import { useStore } from '../state/store';
import { useLookStyles } from '../ui/look';

export function matchClock(tick: number): string {
  const sec = Math.floor((tick * TICK_MS) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function DuelFeed({
  log,
  nickname,
  limit,
  show,
  compact,
}: {
  log: DuelLogEntry[];
  nickname: string;
  /** Only the newest entries. */
  limit?: number;
  /** Shows an amount of the game currency. */
  show: (units: number) => string;
  /** One short line per entry, for the match screen. */
  compact?: boolean;
}) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf, fmt } = useStore();
  const entries = log.slice(limit ? -limit : 0).reverse();
  const nameOf = (id: string) => (id === DUEL_ME ? `${nickname} · ${t('duel.you')}` : (DUEL_BOTS.find((b) => b.id === id)?.name ?? id));
  const money = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${show(Math.abs(v))}`;
  if (!entries.length) return <Text style={[styles.empty, { color: colors.faint }]}>{t('feed.empty')}</Text>;
  return (
    <View style={compact ? styles.compact : styles.list}>
      {entries.map((e, i) => {
        let who = '';
        let what = '';
        let color = colors.text;
        if (e.type === 'news') {
          who = t('feed.news');
          what = t(`news.${e.kind}` as StringKey);
          color = colors.goldText;
        } else {
          who = nameOf(e.traderId);
          const pos = `${t(e.side === 1 ? 'duel.long' : 'duel.short')} x${e.leverage}`;
          if (e.type === 'open') {
            what = `${pos} · ${tf('feed.open', { price: fmt(e.price, 2) })}`;
            color = e.side === 1 ? colors.up : colors.down;
          } else {
            const kind = e.type === 'close' ? 'feed.close' : e.type === 'liquidated' ? 'feed.liq' : 'feed.bell';
            what = `${pos} · ${tf(kind, { pnl: money(e.pnl) })}`;
            color = e.pnl > 0 ? colors.up : e.pnl < 0 ? colors.down : colors.muted;
          }
        }
        const mine = e.type !== 'news' && e.traderId === DUEL_ME;
        return (
          <View key={`${e.tick}-${i}`} style={[styles.row, mine && { backgroundColor: colors.goldSoft }]}>
            <Text style={[styles.time, { color: colors.faint }]}>{matchClock(e.tick)}</Text>
            <Text style={[styles.who, { color: colors.text, fontWeight: mine ? '800' : '600' }]} numberOfLines={1}>
              {who}
            </Text>
            <Text style={[styles.what, { color }]} numberOfLines={compact ? 1 : 2}>
              {what}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  list: { gap: 2 },
  compact: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  time: { width: 34, fontSize: 12, fontVariant: ['tabular-nums'] },
  who: { width: 96, fontSize: 12 },
  what: { flex: 1, fontSize: 12, fontWeight: '700' },
  empty: { fontSize: 12, textAlign: 'center', paddingVertical: 4 },
});
