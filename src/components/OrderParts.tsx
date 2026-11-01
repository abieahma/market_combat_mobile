// Pieces of Order Picking that the shift, the hub, the lobby and the history
// share: the warehouse floor, the hub picture, the lobby sheet, the score,
// the pickers of a shift and the replay.

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import type { OrderAction, OrderScoreView, OrderView } from '../api/contract';
import {
  applyOrder,
  createOrder,
  finishOrder,
  gofraCell,
  holdingAt,
  makeShift,
  ORDER_BOX,
  ORDER_CAP,
  ORDER_COLS,
  ORDER_GOFRAS,
  ORDER_GOODS,
  ORDER_ISLAND,
  ORDER_POINTS,
  ORDER_ROWS,
  ORDER_SHIFT_MS,
  ORDER_SIGNS,
  OrderGood,
  OrderPlace,
  OrderPresort,
  OrderShift,
  OrderState,
  pickerAt,
  playBot,
  presortOf,
  replayOrder,
} from '../game/order';
import { StringKey } from '../i18n/strings';
import { useStore } from '../state/store';
import { useLookStyles, useType } from '../ui/look';
import { Button } from '../ui/kit';
import { Glass, LiftPressable } from '../ui/luxe';
import { fonts, radius, space } from '../ui/theme';
import { Sheet } from './Sheet';

type T = (key: StringKey) => string;

/** Cardboard of the gofras and the box; the same in every look. */
const CARDBOARD = { fill: '#E9D2AE', edge: '#C9A46E', ink: '#4A3418', lit: '#CDEFD9' };
const SIGN = { fill: '#2B2F36', ink: '#FFFFFF' };
/** Colours of the other pickers on the floor, by slot. */
export const PICKER_COLORS = ['#E8833A', '#3BA3D9', '#6BBF59', '#D9536F', '#8C6FD1', '#C9A227', '#4FB8A9', '#E05FA8'];

const CITY_KEYS: Record<OrderPresort, StringKey> = {
  rostov: 'order.city.rostov',
  kazan: 'order.city.kazan',
  samara: 'order.city.samara',
  perm: 'order.city.perm',
  omsk: 'order.city.omsk',
  tula: 'order.city.tula',
  ufa: 'order.city.ufa',
  sochi: 'order.city.sochi',
  orel: 'order.city.orel',
  pskov: 'order.city.pskov',
  tomsk: 'order.city.tomsk',
  kursk: 'order.city.kursk',
  tver: 'order.city.tver',
  chita: 'order.city.chita',
  kirov: 'order.city.kirov',
  penza: 'order.city.penza',
};
const GOOD_KEYS: Record<OrderGood, StringKey> = {
  headphones: 'order.good.headphones',
  mug: 'order.good.mug',
  books: 'order.good.books',
  sneakers: 'order.good.sneakers',
  backpack: 'order.good.backpack',
  lamp: 'order.good.lamp',
  teddy: 'order.good.teddy',
  watch: 'order.good.watch',
  phone: 'order.good.phone',
  cream: 'order.good.cream',
  plant: 'order.good.plant',
  cap: 'order.good.cap',
};
export const cityName = (t: T, p: OrderPresort) => t(CITY_KEYS[p]);
export const goodName = (t: T, good: number) => t(GOOD_KEYS[ORDER_GOODS[good] ?? ORDER_GOODS[0]]);

/** Size of a cell of the floor for a width. */
export function floorCell(width: number): { cell: number; cellH: number } {
  const cell = Math.max(22, Math.floor(width / ORDER_COLS));
  return { cell, cellH: Math.round(cell * 1.15) };
}

export interface FloorPicker {
  key: string;
  r: number;
  c: number;
  /** null: the player. */
  color: string | null;
  carry: 'item' | 'gofra' | null;
}

/**
 * The warehouse floor: the island of gofras, the pre-sorts along the walls,
 * the player's box and the pickers. Full gofras blink; the pre-sort each of
 * them goes to lights up green with its number.
 */
export function OrderFloor({
  width,
  shift,
  fill,
  lifted,
  place,
  wrongSign,
  boxCount,
  pickers,
  blink,
  onGofra,
  onSign,
  onBox,
}: {
  width: number;
  shift: OrderShift;
  fill: number[];
  /** The gofra in the player's hands (its place on the island stays empty). */
  lifted: number | null;
  place: OrderPlace;
  wrongSign: number | null;
  boxCount: number;
  pickers: FloorPicker[];
  /** Blink phase of the full gofras and green pre-sorts. */
  blink: boolean;
  onGofra?: (n: number) => void;
  onSign?: (pos: number) => void;
  onBox?: () => void;
}) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf } = useStore();
  const { cell, cellH } = floorCell(width);
  const box = (r: number, c: number, w = 1, h = 1) => ({ left: c * cell + 2, top: r * cellH + 2, width: cell * w - 4, height: cellH * h - 4 });
  // Pre-sort → the full gofras going there.
  const wanted: Partial<Record<OrderPresort, number[]>> = {};
  for (let n = 1; n <= ORDER_GOFRAS; n++) {
    if (fill[n] < ORDER_CAP) continue;
    const p = presortOf(shift, n);
    (wanted[p] = wanted[p] ?? []).push(n);
  }
  const numberSize = Math.max(11, Math.round(cell * 0.46));
  const citySize = Math.max(6.5, Math.round(cell * 0.24 * 10) / 10);

  return (
    <View style={[styles.floor, { width: cell * ORDER_COLS, height: cellH * ORDER_ROWS, backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}>
      <View
        style={[
          styles.island,
          {
            left: ORDER_ISLAND.c * cell - 4,
            top: ORDER_ISLAND.r * cellH - 4,
            width: ORDER_ISLAND.w * cell + 8,
            height: ORDER_ISLAND.h * cellH + 8,
            backgroundColor: colors.line,
          },
        ]}
      />
      {Array.from({ length: ORDER_GOFRAS }, (_, i) => i + 1).map((n) => {
        const [r, c] = gofraCell(n);
        const away = lifted === n;
        const full = !away && fill[n] >= ORDER_CAP;
        const here = place?.kind === 'gofra' && place.n === n;
        return (
          <Pressable
            key={`g${n}`}
            accessibilityRole="button"
            accessibilityLabel={away ? tf('order.a11yAway', { n }) : tf('order.a11yGofra', { n, fill: fill[n], cap: ORDER_CAP })}
            disabled={!onGofra}
            onPress={() => onGofra?.(n)}
            style={[
              styles.gofra,
              box(r, c),
              {
                backgroundColor: away ? 'transparent' : full && blink ? CARDBOARD.lit : CARDBOARD.fill,
                borderColor: full ? colors.up : CARDBOARD.edge,
                borderStyle: away ? 'dashed' : 'solid',
                borderWidth: full || here ? 2 : 1.5,
              },
              here && { borderColor: colors.goldText },
            ]}
          >
            <Text style={[styles.gofraNo, { fontSize: numberSize, color: CARDBOARD.ink }]}>{n}</Text>
            {!away && (
              <View style={styles.dots}>
                {Array.from({ length: ORDER_CAP }, (_, k) => (
                  <View key={k} style={[styles.dot, { backgroundColor: k < fill[n] ? colors.up : 'rgba(74, 52, 24, 0.25)' }]} />
                ))}
              </View>
            )}
          </Pressable>
        );
      })}
      {ORDER_SIGNS.map(([r, c], pos) => {
        const presort = shift.signs[pos];
        const name = cityName(t, presort);
        // A long name gets a smaller font, so it is never cut.
        const size = Math.min(citySize, Math.round(((cell - 6) / (name.length * 0.66)) * 10) / 10);
        const nums = wanted[presort];
        const wrong = wrongSign === pos;
        const here = place?.kind === 'sign' && place.pos === pos;
        const bg = wrong ? colors.down : nums ? colors.up : SIGN.fill;
        return (
          <Pressable
            key={`s${pos}`}
            accessibilityRole="button"
            accessibilityLabel={nums ? tf('order.a11ySignTarget', { city: name, n: nums.join(', ') }) : tf('order.a11ySign', { city: name })}
            disabled={!onSign}
            onPress={() => onSign?.(pos)}
            style={[
              styles.sign,
              box(r, c),
              { backgroundColor: bg },
              nums && !wrong && blink && { transform: [{ scale: 1.08 }] },
              here && { borderWidth: 2, borderColor: colors.goldText },
            ]}
          >
            <Text style={[styles.city, { fontSize: size, color: SIGN.ink }]} numberOfLines={1}>
              {name}
            </Text>
            {nums && !wrong && (
              <View style={[styles.badge, { borderColor: colors.up }]}>
                <Text style={[styles.badgeText, { color: colors.up }]}>{nums.join(',')}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tf('order.a11yBox', { n: boxCount })}
        disabled={!onBox}
        onPress={() => onBox?.()}
        style={[styles.box, box(ORDER_BOX.r, ORDER_BOX.c, ORDER_BOX.w), place?.kind === 'box' && { borderColor: colors.goldText, borderWidth: 2 }]}
      >
        <Text style={[styles.boxLabel, { color: CARDBOARD.ink }]} numberOfLines={1}>
          {t('order.box')}
        </Text>
        <View style={[styles.boxCount, { backgroundColor: colors.surface }]}>
          <Text style={[styles.boxCountText, { color: colors.text }]}>{boxCount}</Text>
        </View>
      </Pressable>
      {pickers.map((p) => {
        const size = Math.round(cell * (p.color ? 0.4 : 0.5));
        return (
          <View
            key={p.key}
            pointerEvents="none"
            style={[
              styles.picker,
              {
                width: size,
                height: size,
                left: p.c * cell + (cell - size) / 2,
                top: p.r * cellH + (cellH - size) / 2,
                borderRadius: p.carry === 'gofra' ? 4 : size / 2,
                backgroundColor: p.carry === 'gofra' && !p.color ? CARDBOARD.fill : p.color ?? colors.text,
                borderColor: p.color ? colors.surface : p.carry === 'gofra' ? CARDBOARD.edge : colors.surface,
                zIndex: p.color ? 2 : 3,
              },
              !p.color && { borderWidth: 3, shadowColor: colors.goldText, shadowOpacity: 0.9, shadowRadius: 3, shadowOffset: { width: 0, height: 0 } },
            ]}
          />
        );
      })}
    </View>
  );
}

/** Legend under the floor. */
export function FloorLegend() {
  const styles = useLookStyles(baseStyles);
  const { colors, t } = useStore();
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: colors.text, borderColor: colors.goldText }]} />
        <Text style={[styles.legendText, { color: colors.muted }]}>{t('order.you')}</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: PICKER_COLORS[0], borderColor: PICKER_COLORS[1] }]} />
        <Text style={[styles.legendText, { color: colors.muted }]}>{t('order.colleagues')}</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendSquare, { backgroundColor: colors.up }]} />
        <Text style={[styles.legendText, { color: colors.muted }]}>{t('order.whereTo')}</Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------- other pickers

export interface Ghost {
  slot: number;
  nickname: string;
  color: string;
  state: OrderState;
}

/** The other pickers of a shift, played back: the computer of a training shift, or the players of the room who have played. */
export function ghostsOf(shift: OrderShift, view: OrderView): Ghost[] {
  const out: Ghost[] = [];
  for (const r of view.rivals) {
    const color = PICKER_COLORS[r.slot % PICKER_COLORS.length];
    if (r.isBot) out.push({ slot: r.slot, nickname: r.nickname, color, state: playBot(shift, r.slot).state });
    else if (r.actions) out.push({ slot: r.slot, nickname: r.nickname, color, state: replayOrder(shift, r.slot, r.actions, r.endAt ?? ORDER_SHIFT_MS) });
  }
  return out;
}

export function ghostPickers(ghosts: Ghost[], t: number): FloorPicker[] {
  return ghosts.map((g, i) => {
    const p = pickerAt(g.state.walks, t);
    // A little apart, so pickers on the same cell stay visible.
    const dx = ((i % 3) - 1) * 0.08;
    const dy = (Math.floor(i / 3) - 1) * 0.08;
    return { key: `ghost${g.slot}`, r: p.r + dy, c: p.c + dx, color: g.color, carry: holdingAt(g.state, t) };
  });
}

// ------------------------------------------------------------- score and pickers

export function ScoreLines({ score }: { score: OrderScoreView }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf, fmt } = useStore();
  const P = ORDER_POINTS;
  const line = (label: string, value: string, color?: string) => (
    <View style={styles.line} key={label}>
      <Text style={[styles.lineLabel, { color: colors.muted }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: color ?? colors.text }]}>{value}</Text>
    </View>
  );
  return (
    <View style={styles.lines}>
      {line(tf('order.lineItems', { n: score.correct, p: P.item }), `+${fmt(score.correct * P.item)}`)}
      {line(tf('order.lineGofras', { n: score.sent, p: P.gofra }), `+${fmt(score.sent * P.gofra)}`)}
      {line(tf('order.lineMistakes', { n: score.mistakes, p: P.mistake }), `−${fmt(score.mistakes * P.mistake)}`, score.mistakes ? colors.down : undefined)}
      {line(tf('order.lineMissed', { n: score.missed, p: P.missed }), `−${fmt(score.missed * P.missed)}`, score.missed ? colors.down : undefined)}
      {line(t('order.lineBonus'), `+${fmt(score.bonus)}`, score.bonus ? colors.up : undefined)}
      <View style={[styles.line, styles.totalLine, { borderColor: colors.line }]}>
        <Text style={[styles.totalLabel, { color: colors.text }]}>{t('order.total')}</Text>
        <Text style={[styles.totalValue, { color: colors.goldText }]}>{fmt(score.total)}</Text>
      </View>
    </View>
  );
}

export interface StandingRow {
  key: string;
  name: string;
  color: string | null;
  me: boolean;
  score: OrderScoreView | null;
}

/** The pickers of a shift by score; those still playing at the end. */
export function Standings({ rows }: { rows: StandingRow[] }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf, fmt } = useStore();
  const done = rows.filter((r) => r.score).sort((a, b) => b.score!.total - a.score!.total || a.score!.mistakes - b.score!.mistakes);
  const waiting = rows.filter((r) => !r.score);
  let place = 0;
  return (
    <View style={[styles.table, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {done.map((r, i) => {
        const prev = done[i - 1];
        place = prev && prev.score!.total === r.score!.total && prev.score!.mistakes === r.score!.mistakes ? place : i + 1;
        return (
          <View key={r.key} style={[styles.row, r.me && { backgroundColor: colors.goldSoft }]}>
            <Text style={[styles.rowPlace, { color: place === 1 ? colors.goldText : colors.muted }]}>{place}</Text>
            <View style={[styles.rowDot, { backgroundColor: r.color ?? colors.text }]} />
            <View style={styles.rowBody}>
              <Text style={[styles.rowName, { color: colors.text, fontWeight: r.me ? '800' : '600' }]} numberOfLines={1}>
                {r.me ? `${r.name} · ${t('order.you')}` : r.name}
              </Text>
              <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
                {tf('order.rowSub', { items: r.score!.correct, gofras: r.score!.sent, mistakes: r.score!.mistakes })}
              </Text>
            </View>
            <Text style={[styles.rowTotal, { color: colors.text }]}>{fmt(r.score!.total)}</Text>
          </View>
        );
      })}
      {waiting.map((r) => (
        <View key={r.key} style={styles.row}>
          <Text style={[styles.rowPlace, { color: colors.faint }]}>·</Text>
          <View style={[styles.rowDot, { backgroundColor: r.color ?? colors.text }]} />
          <Text style={[styles.rowName, { color: colors.muted, flex: 1 }]} numberOfLines={1}>
            {r.name}
          </Text>
          <Text style={[styles.rowSub, { color: colors.faint }]}>{t('order.notYet')}</Text>
        </View>
      ))}
    </View>
  );
}

export function standingRows(view: OrderView, myName: string, t: T): StandingRow[] {
  return [
    { key: 'me', name: myName, color: null, me: true, score: view.score },
    ...view.rivals.map((r) => ({
      key: `r${r.slot}`,
      name: r.isBot ? `${r.nickname} · ${t('kombat.computer')}` : r.nickname,
      color: PICKER_COLORS[r.slot % PICKER_COLORS.length],
      me: false,
      score: r.score,
    })),
  ];
}

/** Gofras the player took to their pre-sorts. */
export function SentList({ shift, sent }: { shift: OrderShift; sent: number[] }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t } = useStore();
  if (!sent.length) return <Text style={[styles.note, { color: colors.muted }]}>{t('order.sentNone')}</Text>;
  return (
    <View style={styles.chips}>
      {sent.map((n, i) => (
        <View key={`${n}-${i}`} style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.line }]}>
          <Text style={[styles.chipText, { color: colors.text }]}>{`№${n} → ${cityName(t, presortOf(shift, n))}`}</Text>
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------- replay

interface Frame {
  t: number;
  state: OrderState;
}

/** The shift after every action that changed something, by the time it took effect. */
function framesOf(shift: OrderShift, slot: number, actions: OrderAction[], endAt: number): { frames: Frame[]; end: OrderState } {
  let st = createOrder(shift, slot);
  const frames: Frame[] = [{ t: 0, state: st }];
  for (const a of actions) {
    if (st.finished || a.t > endAt) break;
    const res = applyOrder(st, a, shift);
    if (res.outcome === 'refused') continue;
    st = res.state;
    frames.push({ t: Math.min(st.time, ORDER_SHIFT_MS), state: st });
  }
  return { frames, end: finishOrder(st, Math.max(endAt, st.time)) };
}

/** A shift played back on the floor, with the other pickers of the room. */
export function OrderReplay({ view, width }: { view: OrderView; width: number }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, haptic } = useStore();
  const shift = useMemo(() => makeShift(view.seed), [view.seed]);
  const { frames, end } = useMemo(() => framesOf(shift, view.slot, view.actions ?? [], view.endAt ?? ORDER_SHIFT_MS), [shift, view]);
  const ghosts = useMemo(() => ghostsOf(shift, view), [shift, view]);
  const last = Math.max(end.finishedAt ?? ORDER_SHIFT_MS, ...ghosts.map((g) => g.state.finishedAt ?? 0));
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    // Twice as fast as the shift.
    const id = setInterval(() => setAt((x) => Math.min(last, x + 100)), 50);
    return () => clearInterval(id);
  }, [playing, last]);
  useEffect(() => {
    if (at >= last) setPlaying(false);
  }, [at, last]);

  const frame = frames.filter((f) => f.t <= at).pop() ?? frames[0];
  const st = frame.state;
  const me = pickerAt(end.walks, at);
  const pickers: FloorPicker[] = [...ghostPickers(ghosts, at), { key: 'me', r: me.r, c: me.c, color: null, carry: holdingAt(end, at) }];
  const sec = Math.floor(at / 1000);
  const go = (x: number) => {
    haptic('tap');
    setAt(Math.max(0, Math.min(last, x)));
  };

  return (
    <View style={styles.replay}>
      <View style={styles.center}>
        <OrderFloor
          width={width}
          shift={shift}
          fill={st.fill}
          lifted={st.hand?.kind === 'gofra' ? st.hand.n : null}
          place={null}
          wrongSign={null}
          boxCount={st.items.filter((it) => it.at <= at && !st.taken[it.id]).length}
          pickers={pickers}
          blink={Math.floor(at / 450) % 2 === 0}
        />
      </View>
      <View style={styles.controls}>
        <Button variant="ghost" label="⏮" onPress={() => go(0)} style={styles.control} />
        <Button variant="ghost" label="−5s" onPress={() => go(at - 5000)} style={styles.control} />
        <Button
          variant="glass"
          label={playing ? '❚❚' : '▶'}
          onPress={() => {
            if (!playing && at >= last) setAt(0);
            setPlaying((p) => !p);
          }}
          style={styles.control}
        />
        <Button variant="ghost" label="+5s" onPress={() => go(at + 5000)} style={styles.control} />
      </View>
      <Text style={[styles.clock, { color: colors.muted }]}>{`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · ${t('kombat.replay')}`}</Text>
    </View>
  );
}

/** A finished shift in the history: the score, the pickers of the shift and the replay. */
export function OrderDetail({ view, width }: { view: OrderView; width: number }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, profile } = useStore();
  const shift = useMemo(() => makeShift(view.seed), [view.seed]);
  const sent = useMemo(() => (view.actions ? replayOrder(shift, view.slot, view.actions, view.endAt ?? ORDER_SHIFT_MS).sent : []), [shift, view]);
  return (
    <View style={styles.detail}>
      {view.score && (
        <Glass style={styles.panel}>
          <ScoreLines score={view.score} />
        </Glass>
      )}
      <Text style={[tp.label, { color: colors.muted }]}>{t('order.standings')}</Text>
      <Standings rows={standingRows(view, profile?.nickname ?? '', t)} />
      <Text style={[tp.label, { color: colors.muted }]}>{t('order.sentTitle')}</Text>
      <SentList shift={shift} sent={sent} />
      {view.actions && width > 0 && (
        <>
          <Text style={[tp.label, { color: colors.muted }]}>{t('kombat.replay')}</Text>
          <OrderReplay view={view} width={width} />
        </>
      )}
    </View>
  );
}

// ------------------------------------------------------------- hub and lobby

/** The hub picture: the island's two rows of gofras, a full one lit, the way from the box. */
export function OrderVignette({ width, height }: { width: number; height: number }) {
  const { colors, look } = useStore();
  const c = look.brand ? { hi: colors.goldText, mid: colors.goldText, lo: colors.goldText } : { hi: colors.goldHi, mid: colors.gold, lo: colors.goldLo };
  const id = 'orderVignette';
  const L = 18;
  const gap = 5;
  const bw = (width - 2 * L - 7 * gap) / 8;
  const bh = 22;
  const rows = [10, 44];
  const lit = 5;
  const tx = L + lit * (bw + gap) + bw / 2;
  const sx = width / 2;
  const sy = Math.min(108, height - 16);
  const route = `M${sx} ${sy - 12} C${sx} ${sy - 22} ${tx} ${rows[0] + bh + 40} ${tx} ${rows[0] + bh + 6}`;
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={c.hi} />
          <Stop offset="1" stopColor={c.lo} />
        </LinearGradient>
      </Defs>
      {rows.map((y, r) =>
        Array.from({ length: 8 }, (_, k) => {
          const x = L + k * (bw + gap);
          const hot = r === 0 && k === lit;
          return (
            <Rect
              key={`b${r}${k}`}
              x={x}
              y={y}
              width={bw}
              height={bh}
              rx={2.5}
              fill={hot ? `url(#${id})` : c.mid}
              fillOpacity={hot ? 1 : 0.12}
              stroke={hot ? c.hi : c.mid}
              strokeOpacity={hot ? 1 : 0.45}
              strokeWidth={1.2}
            />
          );
        }),
      )}
      <Circle cx={tx} cy={rows[0] + bh / 2} r={bw * 0.85} fill={c.hi} fillOpacity={0.16} />
      <Path d={route} fill="none" stroke={c.hi} strokeOpacity={0.15} strokeWidth={6} strokeLinecap="round" />
      <Path d={route} fill="none" stroke={c.hi} strokeWidth={1.8} strokeDasharray="3 5" strokeLinecap="round" />
      <Rect x={sx - 44} y={sy + 2} width={88} height={10} rx={5} fill={c.mid} fillOpacity={0.25} stroke={c.mid} strokeOpacity={0.5} strokeWidth={1} />
      <Circle cx={sx} cy={sy - 4} r={16} fill={c.hi} fillOpacity={0.14} />
      <Rect x={sx - 8} y={sy - 11} width={16} height={13} rx={2} fill={c.mid} fillOpacity={0.18} stroke={`url(#${id})`} strokeWidth={1.6} />
    </Svg>
  );
}

/** Before a shift: training with the computer (free) or a shift for a stake, and the rules. */
export function OrderLobby({
  visible,
  onClose,
  onTraining,
  onStake,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onTraining: () => void;
  onStake: () => void;
  busy: boolean;
}) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t } = useStore();
  const rules: StringKey[] = ['order.rule1', 'order.rule2', 'order.rule3', 'order.rule4', 'order.rule5', 'order.rule6'];
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: colors.text }]}>{t('order.title')}</Text>
      <LiftPressable onPress={onTraining} disabled={busy} accessibilityLabel={t('order.training')}>
        <Glass style={styles.option}>
          <Text style={[styles.optionTitle, { color: colors.text }]}>{t('order.training')}</Text>
          <Text style={[tp.body, { color: colors.muted }]}>{t('order.trainingNote')}</Text>
        </Glass>
      </LiftPressable>
      <LiftPressable onPress={onStake} disabled={busy} accessibilityLabel={t('order.stake')}>
        <Glass style={[styles.option, { borderColor: colors.gold }]}>
          <Text style={[styles.optionTitle, { color: colors.goldText }]}>{t('order.stake')}</Text>
          <Text style={[tp.body, { color: colors.muted }]}>{t('order.stakeNote')}</Text>
        </Glass>
      </LiftPressable>
      {busy && <ActivityIndicator color={colors.goldText} />}
      <View style={[styles.rules, { borderColor: colors.line }]}>
        <Text style={[styles.rulesTitle, { color: colors.text }]}>{t('order.rulesTitle')}</Text>
        {rules.map((k) => (
          <Text key={k} style={[styles.rule, { color: colors.muted }]}>{`• ${t(k)}`}</Text>
        ))}
      </View>
    </Sheet>
  );
}

const baseStyles = StyleSheet.create({
  floor: { position: 'relative', borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  island: { position: 'absolute', borderRadius: 8, opacity: 0.6 },
  gofra: { position: 'absolute', borderRadius: 4, alignItems: 'center', justifyContent: 'center', gap: 2 },
  gofraNo: { fontWeight: '800' },
  dots: { flexDirection: 'row', gap: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  sign: { position: 'absolute', borderRadius: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1 },
  city: { fontWeight: '700', letterSpacing: -0.3 },
  badge: { position: 'absolute', top: -7, right: -6, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 4, zIndex: 4 },
  badgeText: { fontSize: 9, fontWeight: '800', fontVariant: ['tabular-nums'] },
  box: { position: 'absolute', borderRadius: 6, borderWidth: 1.5, borderColor: CARDBOARD.edge, backgroundColor: CARDBOARD.fill, alignItems: 'center', justifyContent: 'center', gap: 1 },
  boxLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  boxCount: { borderRadius: radius.pill, paddingHorizontal: 6 },
  boxCountText: { fontSize: 10, fontWeight: '800' },
  picker: { position: 'absolute', borderWidth: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  legendSquare: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 11 },
  lines: { gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineLabel: { flex: 1, fontSize: 14 },
  lineValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  totalLine: { borderTopWidth: 1, paddingTop: space.sm, marginTop: 2 },
  totalLabel: { flex: 1, fontSize: 15, fontWeight: '800' },
  totalValue: { fontFamily: fonts.display, fontSize: 26, fontVariant: ['lining-nums'] },
  table: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: 8 },
  rowPlace: { width: 16, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  rowDot: { width: 9, height: 9, borderRadius: 4.5 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 14 },
  rowSub: { fontSize: 12 },
  rowTotal: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  note: { fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, fontWeight: '700' },
  replay: { gap: space.sm },
  center: { alignItems: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  control: { minHeight: 40, paddingHorizontal: 12 },
  clock: { fontSize: 12, textAlign: 'center', fontVariant: ['tabular-nums'] },
  detail: { gap: space.md },
  panel: { padding: space.lg },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36 },
  option: { padding: space.lg, gap: 4, borderRadius: radius.lg },
  optionTitle: { fontFamily: fonts.displaySemi, fontSize: 22 },
  rules: { borderTopWidth: 1, paddingTop: space.md, gap: 6 },
  rulesTitle: { fontSize: 15, fontWeight: '700' },
  rule: { fontSize: 13, lineHeight: 18 },
});

