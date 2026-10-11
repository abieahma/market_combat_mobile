import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PriceChart } from '../components/PriceChart';
import {
  activeNews,
  applyAction,
  createDuel,
  DuelState,
  HISTORY_TICKS,
  Leverage,
  LEVERAGES,
  MATCH_TICKS,
  priceAt,
  rewardForPlace,
  secondsLeft,
  Side,
  Standing,
  standings,
  START_PRICE,
  stepDuel,
  TICK_MS,
  unrealizedPnl,
} from '../game/duel';
import { StringKey } from '../i18n/strings';
import { useStore } from '../state/store';
import { ArrowDown, ArrowUp } from '../ui/icons';
import { Button } from '../ui/kit';
import { radius, space, type } from '../ui/theme';

export interface DuelResult {
  matchId: string;
  standings: Standing[];
  myPlace: number;
  reward: number;
}

const ME = 'me';
const BOTS = [
  { id: 'b1', name: 'BullRush', style: 'momentum' as const },
  { id: 'b2', name: 'Contra', style: 'contrarian' as const },
  { id: 'b3', name: 'Headliner', style: 'newshound' as const },
];
const COUNTDOWN_SECONDS = 3;

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function DuelScreen({ onFinish, onLeave }: { onFinish: (r: DuelResult) => void; onLeave: () => void }) {
  const { colors, t, fmt, profile, haptic } = useStore();
  const seed = useMemo(() => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, []);
  const [duel, setDuel] = useState<DuelState>(() =>
    createDuel(seed, [{ id: ME, name: profile.nickname, isBot: false }, ...BOTS.map((b) => ({ ...b, isBot: true }))]),
  );
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [leverage, setLeverage] = useState<Leverage>(2);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [chartHeight, setChartHeight] = useState(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  // 3-2-1 before the bell.
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  // Game loop.
  const live = countdown <= 0 && !duel.finished;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setDuel((d) => stepDuel(d)), TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  // React to what happened on the last tick.
  useEffect(() => {
    for (const e of duel.events) {
      if (e.type === 'news') haptic('warning');
      if (e.type === 'liquidated' && e.traderId === ME) {
        haptic('error');
        setToast(t('duel.liquidated'));
      }
      if (e.type === 'finished') {
        const final = standings(duel);
        const myPlace = final.find((s) => s.trader.id === ME)?.place ?? final.length;
        haptic(myPlace === 1 ? 'success' : 'warning');
        const result: DuelResult = { matchId: String(seed), standings: final, myPlace, reward: rewardForPlace(myPlace) };
        setTimeout(() => finishRef.current(result), 900);
      }
    }
  }, [duel, haptic, seed, t]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!leaveArmed) return;
    const id = setTimeout(() => setLeaveArmed(false), 2500);
    return () => clearTimeout(id);
  }, [leaveArmed]);

  const price = priceAt(duel);
  const change = price / START_PRICE - 1;
  const me = duel.traders.find((tr) => tr.id === ME)!;
  const pnl = me.position ? unrealizedPnl(me.position, price) : 0;
  const board = standings(duel);
  const news = activeNews(duel);
  const canTrade = live;

  const trade = (side: Side) => {
    if (!canTrade) return;
    haptic('tap');
    setDuel((d) => applyAction(d, ME, { type: 'open', side, leverage }));
  };
  const close = () => {
    if (!canTrade) return;
    haptic(pnl >= 0 ? 'success' : 'tap');
    setDuel((d) => applyAction(d, ME, { type: 'close' }));
  };

  const up = colors.up;
  const down = colors.down;
  const signColor = (v: number) => (v > 0 ? up : v < 0 ? down : colors.muted);
  const pct = (v: number) => `${v > 0 ? '+' : ''}${fmt(v * 100, 2)}%`;

  return (
    <View style={styles.screen}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            haptic('tap');
            if (leaveArmed) onLeave();
            else setLeaveArmed(true);
          }}
          style={[styles.leave, { borderColor: leaveArmed ? down : colors.line, backgroundColor: leaveArmed ? colors.downSoft : 'transparent' }]}
        >
          <Text style={[styles.leaveText, { color: leaveArmed ? down : colors.muted }]} numberOfLines={1}>
            {leaveArmed ? t('duel.leaveConfirm') : t('duel.leave')}
          </Text>
        </Pressable>
        <View style={[styles.timer, { backgroundColor: colors.surface, borderColor: secondsLeft(duel) <= 10 && live ? down : colors.line }]}>
          <Text style={[styles.timerText, type.num, { color: secondsLeft(duel) <= 10 && live ? down : colors.text }]}>
            {clock(countdown > 0 ? Math.round((MATCH_TICKS * TICK_MS) / 1000) : secondsLeft(duel))}
          </Text>
        </View>
      </View>

      <View style={styles.assetRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.ticker, { color: colors.text }]}>MCX</Text>
          <Text style={[styles.assetName, { color: colors.muted }]} numberOfLines={1}>
            {t('duel.index')}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.price, type.num, { color: colors.text }]}>{fmt(price, 2)}</Text>
          <Text style={[styles.change, type.num, { color: signColor(change) }]}>{pct(change)}</Text>
        </View>
      </View>

      <View style={[styles.chartBox, { backgroundColor: colors.surface, borderColor: colors.line }]} onLayout={(e) => setChartHeight(Math.round(e.nativeEvent.layout.height))}>
        {chartHeight > 0 && (
          <PriceChart
            prices={duel.prices.slice(0, HISTORY_TICKS + duel.tick + 1)}
            startIndex={HISTORY_TICKS}
            totalPoints={HISTORY_TICKS + MATCH_TICKS + 1}
            entry={me.position ? { price: me.position.entry, side: me.position.side } : null}
            entryLabel={t('duel.entry')}
            formatPrice={(v) => fmt(v, 2)}
            colors={colors}
            height={chartHeight - 2}
          />
        )}
        {news && (
          <View style={[styles.news, { backgroundColor: colors.news }]}>
            <Text style={[styles.newsTag, { color: colors.newsInk }]}>{t('duel.breaking')}</Text>
            <Text style={[styles.newsText, { color: colors.newsInk }]} numberOfLines={2}>
              {t(`news.${news.kind}` as StringKey)}
            </Text>
          </View>
        )}
        {countdown > 0 && (
          <View style={styles.overlay} pointerEvents="none">
            <Text style={[styles.countdown, { color: colors.gold }]}>{countdown}</Text>
          </View>
        )}
        {toast && (
          <View style={[styles.toast, { backgroundColor: down }]} pointerEvents="none">
            <Text style={[styles.toastText, { color: colors.onSide }]}>{toast}</Text>
          </View>
        )}
      </View>

      <View style={[styles.board, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {board.map((s) => {
          const isMe = s.trader.id === ME;
          return (
            <View key={s.trader.id} style={[styles.boardRow, isMe && { backgroundColor: colors.goldSoft }]}>
              <Text style={[styles.place, type.num, { color: s.place === 1 ? colors.gold : colors.muted }]}>{s.place}</Text>
              <Text style={[styles.boardName, { color: colors.text, fontWeight: isMe ? '800' : '600' }]} numberOfLines={1}>
                {isMe ? `${s.trader.name} · ${t('duel.you')}` : s.trader.name}
              </Text>
              {s.trader.isBot && (
                <Text style={[styles.botTag, { color: colors.faint, borderColor: colors.line }]}>{t('duel.bot')}</Text>
              )}
              {s.trader.position && (
                <View style={[styles.sideDot, { backgroundColor: s.trader.position.side === 1 ? up : down }]} />
              )}
              <Text style={[styles.equity, type.num, { color: colors.text }]}>{fmt(s.equity)}</Text>
              <Text style={[styles.boardChange, type.num, { color: signColor(s.change) }]}>{pct(s.change)}</Text>
            </View>
          );
        })}
      </View>

      <View style={[styles.positionRow, { borderColor: colors.line }]}>
        {me.position ? (
          <>
            <Text style={[styles.positionText, { color: me.position.side === 1 ? up : down }]} numberOfLines={1}>
              {t(me.position.side === 1 ? 'duel.long' : 'duel.short')} x{me.position.leverage}
            </Text>
            <Text style={[styles.positionMeta, type.num, { color: colors.muted }]} numberOfLines={1}>
              {t('duel.entry')} {fmt(me.position.entry, 2)}
            </Text>
            <View style={{ flex: 1 }} />
            <Text style={[styles.pnl, type.num, { color: signColor(pnl) }]}>
              {pnl > 0 ? '+' : ''}
              {fmt(pnl)}
            </Text>
          </>
        ) : (
          <Text style={[styles.positionMeta, { color: colors.muted, flex: 1 }]} numberOfLines={2}>
            {me.trades === 0 ? t('duel.hint') : t('duel.noPosition')}
          </Text>
        )}
      </View>

      {!me.position && (
        <View style={styles.levRow}>
          <Text style={[styles.levLabel, { color: colors.muted }]} numberOfLines={1}>
            {t('duel.leverage')}
          </Text>
          {LEVERAGES.map((lev) => {
            const active = lev === leverage;
            return (
              <Pressable
                key={lev}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptic('tap');
                  setLeverage(lev);
                }}
                style={[styles.levChip, { borderColor: active ? colors.gold : colors.line, backgroundColor: active ? colors.goldSoft : colors.surface }]}
              >
                <Text style={[styles.levText, { color: active ? colors.gold : colors.text }]}>x{lev}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {me.position ? (
        <Button
          big
          variant={pnl >= 0 ? 'up' : 'down'}
          label={`${t('duel.close')} ${pnl > 0 ? '+' : ''}${fmt(pnl)}`}
          onPress={close}
          disabled={!canTrade}
        />
      ) : (
        <View style={styles.tradeRow}>
          <Button
            big
            variant="up"
            label={t('duel.long')}
            icon={<ArrowUp color={colors.onSide} size={20} />}
            onPress={() => trade(1)}
            disabled={!canTrade}
            style={{ flex: 1 }}
          />
          <Button
            big
            variant="down"
            label={t('duel.short')}
            icon={<ArrowDown color={colors.onSide} size={20} />}
            onPress={() => trade(-1)}
            disabled={!canTrade}
            style={{ flex: 1 }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: space.lg, gap: space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  leave: { height: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center', flexShrink: 1 },
  leaveText: { fontSize: 13, fontWeight: '700' },
  timer: { height: 36, minWidth: 76, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  timerText: { fontSize: 18, fontWeight: '800' },
  assetRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  ticker: { fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  assetName: { fontSize: 12 },
  price: { fontSize: 24, fontWeight: '800' },
  change: { fontSize: 13, fontWeight: '700' },
  chartBox: { flex: 1, minHeight: 160, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  news: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    right: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  newsTag: { fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  newsText: { flex: 1, fontSize: 14, fontWeight: '700' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  countdown: { fontSize: 96, fontWeight: '900' },
  toast: { position: 'absolute', bottom: space.md, alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  toastText: { fontSize: 15, fontWeight: '800' },
  board: { borderRadius: radius.md, borderWidth: 1, paddingVertical: 4 },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 30 },
  place: { width: 14, fontSize: 13, fontWeight: '800' },
  boardName: { flexShrink: 1, fontSize: 14 },
  botTag: { fontSize: 9, fontWeight: '800', borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, letterSpacing: 0.5 },
  sideDot: { width: 7, height: 7, borderRadius: 4 },
  equity: { marginLeft: 'auto', fontSize: 14, fontWeight: '700' },
  boardChange: { width: 64, textAlign: 'right', fontSize: 13, fontWeight: '700' },
  positionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: space.sm },
  positionText: { fontSize: 16, fontWeight: '900', textTransform: 'uppercase' },
  positionMeta: { fontSize: 13 },
  pnl: { fontSize: 20, fontWeight: '900' },
  levRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  levLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
  levChip: { minWidth: 48, height: 36, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  levText: { fontSize: 15, fontWeight: '800' },
  tradeRow: { flexDirection: 'row', gap: space.md },
});
