// History of games: the player's finished Chart Duel matches and Market
// Kombat fights, and one of them in full: every turn of a fight with its
// replay, every trade of a match played again from its seed.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DuelRecord, GameId, HistoryDetail, HistoryItem } from '../api/contract';
import { Avatar } from '../components/Avatar';
import { DuelFeed, matchClock } from '../components/DuelFeed';
import { HpChart, KombatReplay, TurnLog } from '../components/KombatParts';
import { PriceChart } from '../components/PriceChart';
import { GAMES } from '../games';
import { DUEL_ME, HISTORY_TICKS, MATCH_TICKS, replayDuel, standings, TICK_MS } from '../game/duel';
import { formatWhen } from '../i18n/strings';
import { api, useStore } from '../state/store';
import { Button, SectionLabel, TopBar } from '../ui/kit';
import { Glass } from '../ui/luxe';
import { fonts, radius, space } from '../ui/theme';
import { characterName } from '../world/characters';
import { useLookStyles, useType } from '../ui/look';

const FILTERS: (GameId | null)[] = [null, 'duel', 'kombat'];

function gameInfo(id: GameId) {
  return GAMES.find((g) => g.id === id) ?? null;
}

/** Win, loss, draw, a place, or why the game did not count. */
function useOutcome() {
  const { colors, t, tf } = useStore();
  return (item: HistoryItem): { text: string; color: string } => {
    if (item.outcome === 'cancelled') return { text: t('history.cancelled'), color: colors.muted };
    if (item.outcome === 'abandoned') return { text: t('history.abandoned'), color: colors.muted };
    if (item.place !== null) return { text: tf('history.place', { n: item.place, of: item.players }), color: item.place === 1 ? colors.goldText : colors.text };
    if (item.outcome === 'win') return { text: t('kombat.win'), color: colors.goldText };
    if (item.outcome === 'draw') return { text: t('kombat.draw'), color: colors.text };
    return { text: t('kombat.lose'), color: colors.down };
  };
}

export function HistoryScreen({ game, onOpen, onBack }: { game: GameId | null; onOpen: (id: string) => void; onBack: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, tf, fmt, haptic, showMoney, settings } = useStore();
  const outcome = useOutcome();
  const [filter, setFilter] = useState<GameId | null>(game);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (from: string | null) => {
      setLoading(true);
      setFailed(false);
      try {
        const page = await api.history.list(filter, from, 20);
        setItems((prev) => (from ? [...prev, ...page.items] : page.items));
        setCursor(page.next);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    setItems([]);
    load(null);
  }, [load]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TopBar title={t('history.games')} onBack={onBack} />

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const on = f === filter;
          const info = f ? gameInfo(f) : null;
          return (
            <Pressable
              key={f ?? 'all'}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                haptic('tap');
                setFilter(f);
              }}
              style={[styles.filter, { borderColor: on ? colors.gold : colors.line, backgroundColor: on ? colors.goldSoft : 'transparent' }]}
            >
              <Text style={[styles.filterText, { color: on ? colors.goldText : colors.text }]} numberOfLines={1}>
                {info ? t(info.title) : t('history.all')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {items.length === 0 && !loading && !failed && <Text style={[styles.empty, { color: colors.muted }]}>{t('history.empty')}</Text>}
        {items.map((item, i) => {
          const info = gameInfo(item.game);
          const o = outcome(item);
          const opponent = item.opponent ? (item.opponent.isBot ? `${characterName(item.opponent.character, settings.lang)} · ${t('kombat.computer')}` : `${item.opponent.nickname} · ${characterName(item.opponent.character, settings.lang)}`) : null;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => {
                haptic('tap');
                onOpen(item.id);
              }}
              style={({ pressed }) => [styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }, pressed && { opacity: 0.7 }]}
            >
              {item.opponent ? (
                <Avatar character={item.opponent.character} gender={item.opponent.gender} size={40} />
              ) : (
                <View style={[styles.place, { borderColor: o.color }]}>
                  <Text style={[styles.placeText, { color: o.color }]}>{item.place ?? '—'}</Text>
                </View>
              )}
              <View style={styles.rowBody}>
                <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                  {info ? t(info.title) : item.game}
                  <Text style={{ color: o.color }}>{`  ${o.text}`}</Text>
                </Text>
                <Text style={[styles.rowMeta, { color: colors.muted }]} numberOfLines={1}>
                  {opponent ? tf('history.vs', { name: opponent }) : tf('history.traders', { n: item.players })}
                </Text>
                <Text style={[styles.rowMeta, tp.num, { color: colors.faint }]} numberOfLines={1}>
                  {formatWhen(item.finishedAt ?? item.startedAt)}
                  {item.mode === 'bot' ? ` · ${t('kombat.training')}` : info && item.stake > 0 ? ` · ${t('result.stake')} ${showMoney(info, item.stake)}` : ''}
                  {item.turns ? ` · ${tf('history.turns', { n: item.turns })}` : ''}
                </Text>
              </View>
              <Text style={[styles.net, tp.num, { color: item.net > 0 ? colors.up : item.net < 0 ? colors.down : colors.muted }]}>
                {item.net > 0 ? '+' : item.net < 0 ? '−' : ''}
                {fmt(Math.abs(item.net))}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading && <ActivityIndicator color={colors.goldText} />}
      {failed && (
        <View style={styles.failRow}>
          <Text style={[tp.body, { color: colors.down, flex: 1 }]}>{t('net.error')}</Text>
          <Button variant="ghost" label={t('net.retry')} onPress={() => load(items.length ? cursor : null)} />
        </View>
      )}
      {cursor && !loading && !failed && <Button variant="ghost" label={t('wallet.more')} onPress={() => load(cursor)} />}
      <Text style={[styles.note, { color: colors.faint }]}>{t('history.netNote')}</Text>
    </ScrollView>
  );
}

export function HistoryDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, fmt, showMoney } = useStore();
  const outcome = useOutcome();
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  const load = useCallback(() => {
    setFailed(false);
    api.history
      .get(id)
      .then(setDetail)
      .catch(() => setFailed(true));
  }, [id]);
  useEffect(load, [load]);

  const item = detail?.item ?? null;
  const info = item ? gameInfo(item.game) : null;
  const o = item ? outcome(item) : null;
  const s = detail?.kombat?.settlement ?? null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TopBar title={info ? t(info.title) : t('history.games')} onBack={onBack} />
      <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} />
      {!detail && !failed && <ActivityIndicator color={colors.goldText} />}
      {failed && (
        <View style={styles.failRow}>
          <Text style={[tp.body, { color: colors.down, flex: 1 }]}>{t('net.error')}</Text>
          <Button variant="ghost" label={t('net.retry')} onPress={load} />
        </View>
      )}
      {item && info && o && (
        <Glass style={styles.summary}>
          <Text style={[styles.outcome, { color: o.color }]}>{o.text}</Text>
          <Text style={[styles.when, tp.num, { color: colors.muted }]}>{formatWhen(item.finishedAt ?? item.startedAt)}</Text>
          <View style={[styles.lines, { borderColor: colors.line }]}>
            {item.mode === 'bot' ? (
              <Text style={[tp.body, { color: colors.muted, textAlign: 'center' }]}>{t('kombat.trainingDone')}</Text>
            ) : (
              <>
                <SummaryLine label={t('result.stake')} value={showMoney(info, item.stake)} />
                {detail?.duel && <SummaryLine label={t('result.final')} value={showMoney(info, detail.duel.equity)} />}
                {s && <SummaryLine label={t('result.final')} value={showMoney(info, s.back + s.fee)} />}
                {(detail?.duel?.fee ?? s?.fee ?? 0) > 0 && <SummaryLine label={t('result.fee')} value={`−${showMoney(info, detail?.duel?.fee ?? s?.fee ?? 0)}`} />}
                <SummaryLine
                  label={t('result.net')}
                  value={`${item.net > 0 ? '+' : item.net < 0 ? '−' : ''}${fmt(Math.abs(item.net))} ABIE`}
                  color={item.net > 0 ? colors.up : item.net < 0 ? colors.down : colors.muted}
                />
              </>
            )}
          </View>
        </Glass>
      )}

      {detail?.kombat && width > 0 && (
        <>
          {detail.kombat.log.length > 0 ? (
            <>
              <SectionLabel>{t('kombat.replay')}</SectionLabel>
              <KombatReplay view={detail.kombat} width={width} />
              <SectionLabel>{t('kombat.log')}</SectionLabel>
              <HpChart view={detail.kombat} width={width} />
              <TurnLog view={detail.kombat} />
            </>
          ) : (
            <Text style={[tp.body, { color: colors.muted }]}>{t('kombat.logEmpty')}</Text>
          )}
        </>
      )}

      {detail?.duel && item && info && <DuelReplay rec={detail.duel} show={(u) => showMoney(info, u)} />}
    </ScrollView>
  );
}

function SummaryLine({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors } = useStore();
  return (
    <View style={styles.line}>
      <Text style={[tp.body, { color: colors.muted, flex: 1 }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: color ?? colors.text }]}>{value}</Text>
    </View>
  );
}

/** A Chart Duel match played again from its seed and the player's actions. */
function DuelReplay({ rec, show }: { rec: DuelRecord; show: (units: number) => string }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, fmt, haptic } = useStore();
  const states = useMemo(() => replayDuel(rec.seed, rec.stake, rec.nickname, rec.actions, rec.endTick), [rec]);
  const lastIndex = states.length - 1;
  const [k, setK] = useState(lastIndex);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (k >= lastIndex) {
      setPlaying(false);
      return;
    }
    // Four times as fast as the match.
    const id = setTimeout(() => setK((x) => Math.min(lastIndex, x + 1)), TICK_MS / 4);
    return () => clearTimeout(id);
  }, [playing, k, lastIndex]);

  const st = states[k];
  const me = st.traders.find((tr) => tr.id === DUEL_ME);
  const board = standings(st);
  const go = (x: number) => {
    haptic('tap');
    setPlaying(false);
    setK(Math.max(0, Math.min(lastIndex, x)));
  };
  const pct = (v: number) => `${v > 0 ? '+' : ''}${fmt(v * 100, 2)}%`;

  return (
    <View style={styles.duel}>
      <SectionLabel>{t('kombat.replay')}</SectionLabel>
      <View style={[styles.chart, { borderColor: colors.line, backgroundColor: colors.surface }]}>
        <PriceChart
          prices={st.prices.slice(0, HISTORY_TICKS + st.tick + 1)}
          startIndex={HISTORY_TICKS}
          totalPoints={HISTORY_TICKS + MATCH_TICKS + 1}
          entry={me?.position ? { price: me.position.entry, side: me.position.side } : null}
          entryLabel={t('duel.entry')}
          formatPrice={(v) => fmt(v, 2)}
          colors={colors}
          height={170}
        />
      </View>
      <View style={styles.controls}>
        <Control label="⏮" onPress={() => go(0)} a11y={t('replay.start')} />
        <Control label="−5s" onPress={() => go(k - 20)} a11y={t('replay.back')} />
        <Control
          label={playing ? '❚❚' : '▶'}
          main
          a11y={playing ? t('replay.pause') : t('replay.play')}
          onPress={() => {
            haptic('tap');
            if (!playing && k >= lastIndex) setK(0);
            setPlaying((p) => !p);
          }}
        />
        <Control label="+5s" onPress={() => go(k + 20)} a11y={t('replay.next')} />
        <Control label="⏭" onPress={() => go(lastIndex)} a11y={t('replay.end')} />
      </View>
      <Text style={[styles.clock, { color: colors.muted }]}>{matchClock(st.tick)} / {matchClock(MATCH_TICKS)}</Text>

      <View style={[styles.board, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {board.map((row) => {
          const isMe = row.trader.id === DUEL_ME;
          return (
            <View key={row.trader.id} style={[styles.boardRow, isMe && { backgroundColor: colors.goldSoft }]}>
              <Text style={[styles.boardPlace, { color: row.place === 1 ? colors.gold : colors.muted }]}>{row.place}</Text>
              <Text style={[styles.boardName, { color: colors.text, fontWeight: isMe ? '800' : '600' }]} numberOfLines={1}>
                {isMe ? `${row.trader.name} · ${t('duel.you')}` : row.trader.name}
              </Text>
              <Text style={[styles.boardMoney, { color: colors.text }]}>{show(row.equity)}</Text>
              <Text style={[styles.boardPct, { color: row.change > 0 ? colors.up : row.change < 0 ? colors.down : colors.muted }]}>{pct(row.change)}</Text>
            </View>
          );
        })}
      </View>

      <SectionLabel>{t('feed.title')}</SectionLabel>
      <DuelFeed log={st.log} nickname={rec.nickname} show={show} />
    </View>
  );
}

function Control({ label, onPress, a11y, main }: { label: string; onPress: () => void; a11y: string; main?: boolean }) {
  const styles = useLookStyles(baseStyles);
  const { colors } = useStore();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => [styles.control, main && styles.controlMain, { borderColor: main ? colors.gold : colors.line, backgroundColor: main ? colors.goldSoft : colors.surface, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.controlText, { color: main ? colors.goldText : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const baseStyles = StyleSheet.create({
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xl * 2 },
  filters: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  filter: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  filterText: { fontSize: 13, fontWeight: '700' },
  list: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  empty: { padding: space.lg, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md },
  place: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  placeText: { fontFamily: fonts.display, fontSize: 22 },
  rowBody: { flex: 1, minWidth: 0, gap: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowMeta: { fontSize: 12 },
  net: { fontSize: 16, fontWeight: '800' },
  note: { fontSize: 12, textAlign: 'center' },
  failRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  summary: { padding: space.lg, gap: space.sm, alignItems: 'stretch' },
  outcome: { fontFamily: fonts.display, fontSize: 36, textAlign: 'center' },
  when: { fontSize: 13, textAlign: 'center' },
  lines: { borderTopWidth: 1, paddingTop: space.sm, gap: 6, marginTop: space.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineValue: { fontFamily: fonts.displaySemi, fontSize: 18, fontVariant: ['lining-nums'] },
  duel: { gap: space.md },
  chart: { height: 172, borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  control: { minWidth: 46, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  controlMain: { minWidth: 58 },
  controlText: { fontSize: 14, fontWeight: '800' },
  clock: { fontSize: 12, textAlign: 'center', fontVariant: ['tabular-nums'] },
  board: { borderRadius: radius.md, borderWidth: 1, paddingVertical: 4 },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 30 },
  boardPlace: { width: 14, fontSize: 13, fontWeight: '800' },
  boardName: { flex: 1, fontSize: 14 },
  boardMoney: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  boardPct: { width: 64, textAlign: 'right', fontSize: 13, fontWeight: '700' },
});
