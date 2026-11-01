// An Order Picking shift. The rules of the game (src/game/order.ts) run
// right here as the player taps: the picker walks, and what a tap does
// happens when they get there. The other pickers on the floor are the
// computer of a training shift or the players of the room who have already
// played. When the shift is over the app sends its actions; the server plays
// them again and counts the score itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { OrderAction, OrderView } from '../api/contract';
import {
  cityName,
  FloorLegend,
  FloorPicker,
  ghostPickers,
  ghostsOf,
  goodName,
  OrderFloor,
  ScoreLines,
  SentList,
  Standings,
  standingRows,
} from '../components/OrderParts';
import { GAMES } from '../games';
import {
  applyOrder,
  createOrder,
  finishOrder,
  inBox,
  makeShift,
  ORDER_CAP,
  ORDER_GOOD_ICONS,
  ORDER_GOODS,
  ORDER_PLAYERS,
  ORDER_POINTS,
  ORDER_SCAN_FADE_MS,
  ORDER_SCAN_MS,
  ORDER_SHIFT_MS,
  OrderOutcome,
  OrderState,
  pickerAt,
  pointsAt,
  presortOf,
} from '../game/order';
import { formatWhen } from '../i18n/strings';
import { api, useStore } from '../state/store';
import { Button, TopBar } from '../ui/kit';
import { Glass } from '../ui/luxe';
import { fonts, radius, space } from '../ui/theme';
import { useLookStyles, useType } from '../ui/look';

const ORDER = GAMES.find((g) => g.id === 'order')!;
const TICK_MS = 50;

type Tap = { type: 'take'; item: number } | { type: 'gofra'; n: number } | { type: 'sign'; pos: number } | { type: 'scan' };
type Tone = 'good' | 'bad' | 'plain';

export function OrderScreen({ start, onHub, onAgain }: { start: OrderView; onHub: () => void; onAgain: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, tf, fmt, haptic, refresh, showMoney } = useStore();
  const shift = useMemo(() => makeShift(start.seed), [start.seed]);
  const ghosts = useMemo(() => ghostsOf(shift, start), [shift, start]);
  // Shift time 0 on this device's clock (the shift may have started a moment ago on the server).
  const origin = useRef(Date.now() - Math.max(0, Math.min(ORDER_SHIFT_MS, start.serverNow - start.startedAt))).current;
  const [now, setNow] = useState(() => Date.now() - origin);
  const [st, setSt] = useState<OrderState>(() => createOrder(shift, start.slot));
  const stRef = useRef(st);
  /** The action under way: the picker is walking, its effect comes on arrival. */
  const pending = useRef<{ next: OrderState; outcome: OrderOutcome; tap: Tap } | null>(null);
  /** A tap made while the picker was busy: done as soon as they are free. */
  const queued = useRef<{ tap: Tap; at: number } | null>(null);
  const actions = useRef<OrderAction[]>([]);
  const [scan, setScan] = useState<{ n: number; at: number } | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: Tone }>({ text: t('order.msgStart'), tone: 'plain' });
  const [wrongSign, setWrongSign] = useState<number | null>(null);
  const [result, setResult] = useState<OrderView | null>(null);
  const [sending, setSending] = useState<'idle' | 'sending' | 'error'>('idle');
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [width, setWidth] = useState(0);
  const [, rerender] = useState(0);

  const commit = useCallback((next: OrderState) => {
    stRef.current = next;
    setSt(next);
  }, []);
  const say = useCallback((text: string, tone: Tone = 'plain') => setMsg({ text, tone }), []);

  /** Tells the player what the action did. */
  const report = useCallback(
    (outcome: OrderOutcome, next: OrderState, tap: Tap, at: number) => {
      switch (outcome) {
        case 'took':
        case 'scanned': {
          const it = next.hand?.kind === 'item' ? next.items[next.hand.id] : null;
          if (!it) return;
          setScan({ n: it.gofra, at });
          haptic('tap');
          say(outcome === 'took' ? t('order.msgTook') : t('order.msgRescan'), 'good');
          return;
        }
        case 'dropped':
          haptic('success');
          return say(tf('order.msgDropped', { n: tap.type === 'gofra' ? tap.n : 0, p: ORDER_POINTS.item }), 'good');
        case 'filled':
          haptic('success');
          return say(tf('order.msgFilled', { n: tap.type === 'gofra' ? tap.n : 0 }), 'good');
        case 'wrongGofra':
          haptic('error');
          return say(tf('order.msgWrongGofra', { p: ORDER_POINTS.mistake }), 'bad');
        case 'lifted': {
          const n = next.hand?.kind === 'gofra' ? next.hand.n : 0;
          haptic('tap');
          return say(tf('order.msgLifted', { n, city: cityName(t, presortOf(shift, n)) }), 'good');
        }
        case 'delivered': {
          const n = next.sent[next.sent.length - 1];
          haptic('success');
          return say(tf('order.msgDelivered', { n, city: cityName(t, presortOf(shift, n)), p: ORDER_POINTS.gofra }), 'good');
        }
        case 'wrongSign': {
          const n = next.hand?.kind === 'gofra' ? next.hand.n : 0;
          const pos = tap.type === 'sign' ? tap.pos : -1;
          haptic('error');
          setWrongSign(pos);
          setTimeout(() => setWrongSign((w) => (w === pos ? null : w)), 700);
          return say(tf('order.msgWrongSign', { n, city: cityName(t, presortOf(shift, n)), p: ORDER_POINTS.mistake }), 'bad');
        }
        default:
          return;
      }
    },
    [haptic, say, shift, t, tf],
  );

  /** Plays a tap at a moment of the shift; a tap that makes no sense now is explained instead. */
  const run = useCallback(
    (tap: Tap, at: number) => {
      const cur = stRef.current;
      // After the bell nothing counts: the shift closes on the next tick.
      if (cur.finished || at >= ORDER_SHIFT_MS) return;
      const h = cur.hand;
      if (tap.type === 'take' && h) return say(h.kind === 'item' ? t('order.msgBusyItem') : t('order.msgBusyGofra'), 'bad');
      if (tap.type === 'gofra' && h?.kind === 'gofra') return say(t('order.msgBusyGofra'), 'bad');
      if (tap.type === 'gofra' && !h && cur.fill[tap.n] < ORDER_CAP) return say(t('order.msgTakeFirst'));
      if (tap.type === 'sign' && h?.kind !== 'gofra') return say(tf('order.msgSign', { city: cityName(t, shift.signs[tap.pos]) }));
      const action = { ...tap, t: Math.max(0, Math.floor(at)) } as OrderAction;
      const res = applyOrder(cur, action, shift);
      if (res.outcome === 'refused') return;
      actions.current.push(action);
      if (res.outcome === 'scanned') {
        commit(res.state);
        report('scanned', res.state, tap, at);
        return;
      }
      pending.current = { next: res.state, outcome: res.outcome, tap };
      rerender((x) => x + 1);
    },
    [commit, report, say, shift, t, tf],
  );

  const tapOn = useCallback(
    (tap: Tap) => {
      if (result || stRef.current.finished) return;
      const at = Date.now() - origin;
      if (pending.current) {
        queued.current = { tap, at };
        return;
      }
      run(tap, at);
    },
    [origin, result, run],
  );

  // The clock of the shift.
  const over = st.finished;
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => setNow(Date.now() - origin), TICK_MS);
    return () => clearInterval(id);
  }, [origin, over]);

  // What a walk was for happens on arrival; the bell closes the shift.
  useEffect(() => {
    const p = pending.current;
    if (p) {
      const due = p.outcome === 'late' ? ORDER_SHIFT_MS : p.next.time;
      if (now < due) return;
      pending.current = null;
      commit(p.next);
      report(p.outcome, p.next, p.tap, due);
      const q = queued.current;
      queued.current = null;
      if (q && !p.next.finished) run(q.tap, q.at);
      return;
    }
    if (now >= ORDER_SHIFT_MS && !stRef.current.finished) commit(finishOrder(stRef.current));
  }, [now, commit, report, run]);

  const send = useCallback(async () => {
    const s = stRef.current;
    setSending('sending');
    try {
      const v = await api.order.finish(start.id, actions.current, s.finishedAt ?? ORDER_SHIFT_MS);
      setResult(v);
      setSending('idle');
      haptic(v.place === 1 ? 'success' : 'tap');
      refresh();
    } catch {
      setSending('error');
    }
  }, [haptic, refresh, start.id]);

  useEffect(() => {
    if (over && !result && sending === 'idle') send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  // A stake shift waits for the room to close; ask now and then.
  useEffect(() => {
    if (result?.status !== 'waiting') return;
    const id = setInterval(() => {
      api.order
        .get(start.id)
        .then((v) => {
          setResult(v);
          if (v.status !== 'waiting') refresh();
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [result?.status, refresh, start.id]);

  useEffect(() => {
    if (!leaveArmed) return;
    const id = setTimeout(() => setLeaveArmed(false), 3500);
    return () => clearTimeout(id);
  }, [leaveArmed]);

  /** Leaving counts the shift as it is now; it takes a second tap. */
  const leave = () => {
    if (result || over) return onHub();
    if (!leaveArmed) {
      setLeaveArmed(true);
      haptic('warning');
      say(t('order.leaveConfirm'), 'bad');
      return;
    }
    if (pending.current) {
      actions.current.pop();
      pending.current = null;
    }
    queued.current = null;
    commit(finishOrder(stRef.current, Date.now() - origin));
  };

  if (result) return <OrderResult view={result} onHub={onHub} onAgain={onAgain} />;

  const p = pending.current;
  const shown = p?.next ?? st;
  const me = pickerAt(shown.walks, now);
  const pickers: FloorPicker[] = [...ghostPickers(ghosts, now), { key: 'me', r: me.r, c: me.c, color: null, carry: st.hand?.kind ?? null }];
  const takingId = p?.tap.type === 'take' ? p.tap.item : null;
  const box = inBox(st, Math.min(now, ORDER_SHIFT_MS)).filter((it) => it.id !== takingId);
  const points = st.correct * ORDER_POINTS.item + st.sent.length * ORDER_POINTS.gofra - st.mistakes * ORDER_POINTS.mistake;
  const place = 1 + ghosts.filter((g) => pointsAt(g.state, now) > points).length;
  const left = Math.max(0, Math.ceil((ORDER_SHIFT_MS - now) / 1000));
  const age = scan ? now - scan.at : Infinity;
  const scanOpacity = age < ORDER_SCAN_MS ? 1 : age < ORDER_SCAN_MS + ORDER_SCAN_FADE_MS ? 1 - (age - ORDER_SCAN_MS) / ORDER_SCAN_FADE_MS : 0;
  const h = st.hand;
  const held = h?.kind === 'item' ? st.items[h.id] : null;
  const tone = msg.tone === 'good' ? colors.up : msg.tone === 'bad' ? colors.down : colors.muted;
  const allIn = st.items.every((it) => st.taken[it.id]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TopBar title={t('order.title')} onBack={leave} />

      <View style={styles.stats}>
        <Stat label={t('order.points')} value={fmt(points)} />
        <Stat label={t('order.time')} value={`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`} warn={left <= 10} />
        <Stat label={t('order.place')} value={`${place}`} />
        <Stat label={t('order.sent')} value={fmt(st.sent.length)} />
        <Stat label={t('order.mistakes')} value={fmt(st.mistakes)} />
      </View>

      <View style={styles.floorWrap} onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
        {width > 0 && (
          <OrderFloor
            width={width}
            shift={shift}
            fill={st.fill}
            lifted={h?.kind === 'gofra' ? h.n : null}
            place={p ? null : st.place}
            wrongSign={wrongSign}
            boxCount={box.length}
            pickers={pickers}
            blink={Math.floor(now / 450) % 2 === 0}
            onGofra={(n) => tapOn({ type: 'gofra', n })}
            onSign={(pos) => tapOn({ type: 'sign', pos })}
            onBox={() => box.length && tapOn({ type: 'take', item: box[0].id })}
          />
        )}
      </View>
      <FloorLegend />

      <Text style={[styles.msg, { color: tone }]} accessibilityLiveRegion="polite">
        {msg.text}
      </Text>

      <View style={styles.deck}>
        <View style={styles.scanner} accessibilityLabel={t('order.scanner')}>
          <Text style={styles.scannerLabel}>{t('order.scanner')}</Text>
          <Text style={[styles.scannerNo, { opacity: scan ? scanOpacity : 0.35 }]}>{scan && scanOpacity > 0 ? scan.n : '—'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={held ? t('order.handsItemHint') : undefined}
          onPress={() => held && tapOn({ type: 'scan' })}
          style={({ pressed }) => [styles.hands, { backgroundColor: colors.surface, borderColor: colors.line, opacity: pressed && held ? 0.8 : 1 }]}
        >
          <Text style={styles.handsIcon}>{held ? ORDER_GOOD_ICONS[ORDER_GOODS[held.good]] : h?.kind === 'gofra' ? '📦' : '✋'}</Text>
          <View style={styles.handsText}>
            <Text style={[styles.handsTitle, { color: colors.text }]} numberOfLines={1}>
              {held ? goodName(t, held.good) : h?.kind === 'gofra' ? tf('order.handsGofra', { n: h.n }) : takingId !== null ? t('order.handsTaking') : t('order.handsFree')}
            </Text>
            <Text style={[styles.handsHint, { color: colors.muted }]} numberOfLines={2}>
              {held
                ? t('order.handsItemHint')
                : h?.kind === 'gofra'
                  ? tf('order.handsGofraHint', { city: cityName(t, presortOf(shift, h.n)) })
                  : t('order.handsFreeHint')}
            </Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.laneHead}>
        <Text style={[styles.laneTitle, { color: colors.text }]}>{t('order.box')}</Text>
        <Text style={[styles.laneHint, { color: colors.muted }]}>{t('order.boxHint')}</Text>
      </View>
      <View style={styles.items}>
        {box.length === 0 ? (
          <Text style={[styles.laneHint, { color: colors.muted }]}>{allIn ? t('order.boxDone') : t('order.boxEmpty')}</Text>
        ) : (
          box.map((it) => (
            <Pressable
              key={it.id}
              accessibilityRole="button"
              accessibilityLabel={tf('order.a11yTake', { good: goodName(t, it.good) })}
              onPress={() => tapOn({ type: 'take', item: it.id })}
              style={({ pressed }) => [styles.item, { backgroundColor: colors.surface, borderColor: colors.line, opacity: pressed ? 0.75 : 1 }]}
            >
              <Text style={styles.itemIcon}>{ORDER_GOOD_ICONS[ORDER_GOODS[it.good]]}</Text>
              <QrMark color={colors.text} />
            </Pressable>
          ))
        )}
      </View>

      {sending === 'sending' && <ActivityIndicator color={colors.goldText} />}
      {sending === 'error' && (
        <View style={styles.failRow}>
          <Text style={[tp.body, { color: colors.down, flex: 1 }]}>{t('net.error')}</Text>
          <Button variant="ghost" label={t('net.retry')} onPress={send} />
        </View>
      )}
      {start.mode === 'stake' && (
        <Text style={[styles.note, { color: colors.faint }]}>{tf('order.stakeLine', { stake: showMoney(ORDER, start.stake) })}</Text>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  const styles = useLookStyles(baseStyles);
  const { colors } = useStore();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Text style={[styles.statValue, { color: warn ? colors.down : colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The little code on a good that the scanner reads. */
function QrMark({ color }: { color: string }) {
  const styles = useLookStyles(baseStyles);
  const on = [1, 0, 1, 0, 1, 0, 1, 1, 0];
  return (
    <View style={styles.qr}>
      {on.map((x, i) => (
        <View key={i} style={[styles.qrDot, { backgroundColor: x ? color : 'transparent' }]} />
      ))}
    </View>
  );
}

/** After the shift: the place, the score, the money of a stake and the pickers of the shift. */
function OrderResult({ view, onHub, onAgain }: { view: OrderView; onHub: () => void; onAgain: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, tf, fmt, showMoney, profile } = useStore();
  const shift = useMemo(() => makeShift(view.seed), [view.seed]);
  const sent = useMemo(() => {
    let s = createOrder(shift, view.slot);
    for (const a of view.actions ?? []) s = applyOrder(s, a, shift).state;
    return s.sent;
  }, [shift, view]);
  const players = view.settlement?.players ?? (view.mode === 'training' ? ORDER_PLAYERS : 1 + view.rivals.length);
  const s = view.settlement;
  const line = (label: string, value: string, color?: string) => (
    <View style={styles.line}>
      <Text style={[tp.body, { color: colors.muted, flex: 1 }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: color ?? colors.text }]}>{value}</Text>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TopBar title={t('order.title')} onBack={onHub} />
      <Glass style={styles.result}>
        <Text style={[styles.place, { color: view.place === 1 && view.status !== 'waiting' ? colors.goldText : colors.text }]}>
          {view.status === 'waiting' ? t('order.waitingTitle') : view.place ? tf('history.place', { n: view.place, of: players }) : t('history.abandoned')}
        </Text>
        {view.score && <ScoreLines score={view.score} />}
        <View style={[styles.money, { borderColor: colors.line }]}>
          {view.mode === 'training' && <Text style={[tp.body, { color: colors.muted, textAlign: 'center' }]}>{t('order.trainingDone')}</Text>}
          {view.mode === 'stake' && view.status === 'waiting' && (
            <Text style={[tp.body, { color: colors.muted }]}>{tf('order.waiting', { time: view.closesAt ? formatWhen(view.closesAt) : '' })}</Text>
          )}
          {view.mode === 'stake' && s && (
            <>
              {line(t('result.stake'), showMoney(ORDER, s.stake))}
              {s.refunded ? (
                <Text style={[tp.body, { color: colors.muted }]}>{s.players <= 1 ? t('order.refundedAlone') : t('order.refundedTie')}</Text>
              ) : (
                <>
                  {line(t('order.won'), showMoney(ORDER, s.back))}
                  {s.fee > 0 && line(t('order.fee'), `−${showMoney(ORDER, s.fee)}`)}
                </>
              )}
              {line(t('result.net'), `${s.net > 0 ? '+' : s.net < 0 ? '−' : ''}${fmt(Math.abs(s.net))} ABIE`, s.net > 0 ? colors.up : s.net < 0 ? colors.down : colors.muted)}
            </>
          )}
        </View>
        <Button label={t('order.again')} onPress={onAgain} big />
        <Button label={t('result.toHub')} onPress={onHub} variant="ghost" />
      </Glass>

      <Text style={[tp.label, { color: colors.muted }]}>{t('order.standings')}</Text>
      <Standings rows={standingRows(view, profile?.nickname ?? '', t)} />
      <Text style={[tp.label, { color: colors.muted }]}>{t('order.sentTitle')}</Text>
      <SentList shift={shift} sent={sent} />
    </ScrollView>
  );
}

const baseStyles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  stats: { flexDirection: 'row', gap: 5 },
  stat: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: radius.sm, paddingVertical: 6, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 10.5 },
  floorWrap: { alignItems: 'center' },
  msg: { minHeight: 20, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  deck: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  scanner: { width: 88, borderRadius: 14, backgroundColor: '#10161C', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 2 },
  scannerLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.55)' },
  scannerNo: { fontSize: 34, fontWeight: '800', color: '#4BE38A', fontVariant: ['tabular-nums'] },
  hands: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 8 },
  handsIcon: { fontSize: 28 },
  handsText: { flex: 1, minWidth: 0, gap: 2 },
  handsTitle: { fontSize: 15, fontWeight: '800' },
  handsHint: { fontSize: 12 },
  laneHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  laneTitle: { fontSize: 15, fontWeight: '800' },
  laneHint: { fontSize: 12 },
  items: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 56 },
  item: { width: 56, borderWidth: 1.5, borderRadius: radius.sm, alignItems: 'center', paddingVertical: 5, gap: 2 },
  itemIcon: { fontSize: 22 },
  qr: { width: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 1 },
  qrDot: { width: 4, height: 4 },
  failRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  note: { fontSize: 12, textAlign: 'center' },
  result: { padding: space.lg, gap: space.md },
  place: { fontFamily: fonts.display, fontSize: 34, textAlign: 'center' },
  money: { borderTopWidth: 1, paddingTop: space.sm, gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineValue: { fontFamily: fonts.displaySemi, fontSize: 18, fontVariant: ['lining-nums'] },
});
