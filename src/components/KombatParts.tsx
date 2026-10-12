// Pieces of the Market Kombat screen that the fight and the history share:
// a fighter with bars and effects, the table with the two cards of a turn,
// the turn-by-turn log, the health chart and the step-by-step replay.

import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import type { KombatEffect, KombatFighterView, KombatTurnSide, KombatTurnView, KombatView } from '../api/contract';
import { cardDef, KOMBAT_BOOST_COMBO, KOMBAT_COMBO_BONUS, KOMBAT_COMBO_MAX, KOMBAT_MAX_ENERGY, KOMBAT_MAX_HP, KOMBAT_START_ENERGY } from '../game/kombat';
import { StringKey } from '../i18n/strings';
import { useStore } from '../state/store';
import { useReducedMotion } from '../ui/luxe';
import { fonts, radius, space } from '../ui/theme';
import { characterName, worldColor } from '../world/characters';
import { useLookStyles } from '../ui/look';
import { Avatar } from './Avatar';
import { CardChip, cardName, EnergyIcon, KombatCard } from './cards';

const native = Platform.OS !== 'web';
type T = (key: StringKey) => string;
type TF = (key: StringKey, vars: Record<string, string | number>) => string;

/** A fighter's numbers at one moment: now, or a step of a replay. */
export interface Snapshot {
  hp: number;
  energy: number;
  combo: number;
  effects: KombatEffect[];
}

export function snapshotAt(view: KombatView, side: 0 | 1, step: number | null): Snapshot {
  const f = view.fighters[side];
  if (step === null) return { hp: f?.hp ?? KOMBAT_MAX_HP, energy: f?.energy ?? KOMBAT_START_ENERGY, combo: f?.combo ?? 0, effects: f?.effects ?? [] };
  if (step <= 0) return { hp: KOMBAT_MAX_HP, energy: KOMBAT_START_ENERGY, combo: 0, effects: [] };
  const s = view.log[step - 1].sides[side];
  return { hp: Math.max(0, s.hp), energy: s.energy, combo: s.combo, effects: s.effects };
}

/** m:ss since the fight began. */
export function fightClock(view: KombatView, at: number): string {
  const sec = Math.max(0, Math.round((at - (view.startedAt ?? view.createdAt)) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function fighterName(f: KombatFighterView | null, t: T): string {
  return f ? (f.isBot ? t('kombat.computer') : f.nickname) : '';
}

// ------------------------------------------------------------------ fighter

export function FighterRow({
  f,
  snap,
  name,
  mine,
  hit,
  damage,
}: {
  f: KombatFighterView;
  snap: Snapshot;
  name: string;
  mine?: boolean;
  /** Runs 0 → 1 when the fighter is hit. */
  hit?: Animated.Value;
  /** The last damage, shown floating up over the portrait. */
  damage?: { n: number; crit: boolean; key: number } | null;
}) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf, settings, scheme } = useStore();
  const tint = worldColor(f.character, scheme);
  const shake = hit ? hit.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 0.6, 1], outputRange: [0, -6, 6, -4, 3, 0] }) : 0;
  const flash = hit ? hit.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.55, 0] }) : 0;
  const rise = hit ? hit.interpolate({ inputRange: [0, 1], outputRange: [0, -24] }) : 0;
  const fade = hit ? hit.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] }) : 0;
  const hpColor = snap.hp > 50 ? colors.up : snap.hp > 25 ? colors.gold : colors.down;
  return (
    <View style={styles.fighter}>
      <Animated.View style={{ transform: [{ translateX: shake }] }}>
        <Avatar character={f.character} gender={f.gender} size={58} />
        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash, backgroundColor: colors.down }]} />
        {damage && damage.n > 0 && (
          <Animated.Text key={damage.key} style={[styles.damage, { color: damage.crit ? colors.goldHi : colors.down, opacity: fade, transform: [{ translateY: rise }] }]}>
            −{damage.n}
            {damage.crit ? '!' : ''}
          </Animated.Text>
        )}
      </Animated.View>
      <View style={styles.fighterBody}>
        <View style={styles.nameRow}>
          <Text style={[styles.charName, { color: tint }]} numberOfLines={1}>
            {characterName(f.character, settings.lang)}
          </Text>
          <Text style={[styles.nick, { color: colors.muted }]} numberOfLines={1}>
            {mine ? t('prop.you') : name}
            {f.boosted ? ` · ${t('kombat.boosted')}` : ''}
          </Text>
        </View>
        <Meter label={t('kombat.hp')} value={snap.hp} max={KOMBAT_MAX_HP} color={hpColor} />
        <Meter label={t('kombat.energy')} value={snap.energy} max={KOMBAT_MAX_ENERGY} color={tint} icon={<EnergyIcon size={11} color={tint} />} />
        <View style={styles.statusRow}>
          <View style={styles.pips} accessibilityLabel={tf('kombat.comboLevel', { n: snap.combo })}>
            <Text style={[styles.pipLabel, { color: colors.muted }]}>{t('kombat.combo')}</Text>
            {Array.from({ length: KOMBAT_COMBO_MAX }, (_, i) => (
              <View key={i} style={[styles.pip, { borderColor: colors.goldText, backgroundColor: i < snap.combo ? colors.goldText : 'transparent' }]} />
            ))}
          </View>
          {snap.effects.map((e) => (
            <EffectChip key={e.kind} e={e} />
          ))}
        </View>
      </View>
    </View>
  );
}

function Meter({ label, value, max, color, icon }: { label: string; value: number; max: number; color: string; icon?: ReactNode }) {
  const styles = useLookStyles(baseStyles);
  const { colors } = useStore();
  return (
    <View style={styles.meter} accessibilityLabel={`${label} ${value}/${max}`}>
      <View style={[styles.bar, { backgroundColor: colors.surfaceAlt }]}>
        <View style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
      </View>
      <View style={styles.meterText}>
        {icon}
        <Text style={[styles.meterValue, { color: colors.text }]}>
          {value}
          <Text style={{ color: colors.faint }}>/{max}</Text>
        </Text>
      </View>
    </View>
  );
}

export function EffectChip({ e }: { e: KombatEffect }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf } = useStore();
  const tone = e.kind === 'shield' ? colors.up : e.kind === 'poison' ? colors.down : colors.goldText;
  const text = e.kind === 'stun' ? t('status.stun') : tf(e.kind === 'shield' ? 'status.shield' : 'status.poison', { n: e.amount, turns: e.turns });
  return (
    <View style={[styles.effect, { borderColor: tone }]}>
      <Text style={[styles.effectText, { color: tone }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

// -------------------------------------------------------------------- table

/** What happened in a turn to and by one fighter, as short notes. */
export function sideNotes(side: KombatTurnSide, t: T, tf: TF): { text: string; tone: 'up' | 'down' | 'gold' | 'muted' }[] {
  const notes: { text: string; tone: 'up' | 'down' | 'gold' | 'muted' }[] = [];
  if (side.attack > 0) notes.push({ text: side.dealt === side.attack ? tf('log.hit', { n: side.attack }) : tf('log.hitPart', { n: side.dealt, of: side.attack }), tone: 'gold' });
  if (side.crit) notes.push({ text: t('log.crit'), tone: 'gold' });
  if (side.chain) notes.push({ text: t('log.chain'), tone: 'muted' });
  if (side.comboUsed > 0) notes.push({ text: tf('log.comboUsed', { n: Math.round(side.comboUsed * KOMBAT_COMBO_BONUS * 100) }), tone: 'muted' });
  if (side.card && cardDef(side.card).kind === 'boost' && !side.caught) notes.push({ text: tf('log.comboUp', { n: KOMBAT_BOOST_COMBO }), tone: 'gold' });
  if (side.absorbed > 0) notes.push({ text: tf('log.absorbed', { n: side.absorbed }), tone: 'muted' });
  if (side.counter > 0) notes.push({ text: tf('log.counter', { n: side.counter }), tone: 'gold' });
  if (side.healed > 0) notes.push({ text: tf('log.healed', { n: side.healed }), tone: 'up' });
  for (const e of side.applied) {
    if (e.kind === 'shield') notes.push({ text: tf('log.shield', { n: e.amount }), tone: 'up' });
    if (e.kind === 'poison') notes.push({ text: tf('log.poisoned', { n: e.amount }), tone: 'gold' });
    if (e.kind === 'stun') notes.push({ text: t('log.stunned'), tone: 'gold' });
  }
  if (side.stole > 0) notes.push({ text: tf('log.stole', { n: side.stole }), tone: 'gold' });
  if (side.poison > 0) notes.push({ text: tf('log.poison', { n: side.poison }), tone: 'down' });
  if (side.caught) notes.push({ text: t('log.caught'), tone: 'down' });
  return notes;
}

/** The name of what a fighter did in a turn. */
export function playTitle(side: KombatTurnSide, t: T): string {
  const p = side.play;
  if (p.kind === 'card') return side.card ? (p.card === 'joker' ? `${t('card.joker')} → ${cardName(side.card, t)}` : cardName(side.card, t)) : t('card.joker');
  if (p.kind === 'rest') return p.discarded ? `${t('log.rest')} · ${t('log.swap')}` : t('log.rest');
  return p.kind === 'stunned' ? t('log.skip') : t('log.timeout');
}

/** The two cards of a turn, the player's on the left; they turn over when a new turn is played. */
export function TurnTable({ turn, view, width, pending }: { turn: KombatTurnView | null; view: KombatView; width: number; pending?: string | null }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf } = useStore();
  const reduced = useReducedMotion();
  const flip = useRef(new Animated.Value(1)).current;
  const shown = useRef(turn?.turn ?? 0);
  useEffect(() => {
    const n = turn?.turn ?? 0;
    if (n === shown.current) return;
    shown.current = n;
    if (reduced) return;
    flip.setValue(0);
    Animated.timing(flip, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(1.4)), useNativeDriver: native }).start();
  }, [turn, reduced, flip]);

  const me = view.you;
  const them = (me === 0 ? 1 : 0) as 0 | 1;
  const cardW = Math.min(88, Math.floor((width - space.md * 3) / 4.2));
  const half = (i: 0 | 1) => {
    const side = turn?.sides[i] ?? null;
    const owner = view.fighters[i]?.character ?? null;
    const notes = side ? sideNotes(side, t, tf) : [];
    const toneColor = { up: colors.up, down: colors.down, gold: colors.goldText, muted: colors.muted };
    return (
      <View style={styles.half}>
        <Text style={[styles.halfWho, { color: colors.muted }]} numberOfLines={1}>
          {i === me ? t('prop.you') : fighterName(view.fighters[i], t)}
        </Text>
        <Animated.View style={{ transform: [{ scaleX: flip }] }}>
          {side && side.play.kind === 'card' ? (
            <KombatCard card={side.play.card} as={side.play.as} owner={owner} width={cardW} />
          ) : side ? (
            <View style={[styles.noCard, { width: cardW, height: Math.round(cardW * 1.42), borderColor: colors.line }]}>
              <Text style={[styles.noCardText, { color: colors.muted }]} numberOfLines={3}>
                {playTitle(side, t)}
              </Text>
            </View>
          ) : (
            <KombatCard card="joker" owner={null} width={cardW} faceDown />
          )}
        </Animated.View>
        {side ? (
          <View style={styles.notes}>
            <Text style={[styles.playName, { color: colors.text }]} numberOfLines={2}>
              {playTitle(side, t)}
            </Text>
            {side.taken > 0 && <Text style={[styles.taken, { color: colors.down }]}>{`${t('kombat.hp')} −${side.taken}`}</Text>}
            {notes.map((n, k) => (
              <Text key={k} style={[styles.note, { color: toneColor[n.tone] }]} numberOfLines={1}>
                {n.text}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={[styles.note, { color: colors.muted, textAlign: 'center' }]}>{i === me && pending ? pending : ' '}</Text>
        )}
      </View>
    );
  };
  return (
    <View style={[styles.table, { borderColor: colors.line }]}>
      {half(me)}
      <View style={styles.tableMid}>
        <Text style={[styles.tableTurn, { color: colors.goldText }]}>{turn ? tf('kombat.turnShort', { n: turn.turn }) : t('kombat.firstTurn')}</Text>
        {turn && <Text style={[styles.tableTime, { color: colors.faint }]}>{fightClock(view, turn.at)}</Text>}
      </View>
      {half(them)}
    </View>
  );
}

// ---------------------------------------------------------------------- log

/** Every played turn, newest first: when, who played what, what it did, health after. */
export function TurnLog({ view, upto }: { view: KombatView; upto?: number }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf } = useStore();
  const turns = view.log.slice(0, upto ?? view.log.length).reverse();
  const me = view.you;
  const order = [me, (me === 0 ? 1 : 0) as 0 | 1];
  if (!turns.length) return <Text style={[styles.note, { color: colors.muted }]}>{t('kombat.logEmpty')}</Text>;
  return (
    <View style={styles.log}>
      {turns.map((turn) => (
        <View key={turn.turn} style={[styles.logTurn, { borderColor: colors.line }]}>
          <View style={styles.logHead}>
            <Text style={[styles.logTurnText, { color: colors.goldText }]}>{tf('kombat.turnShort', { n: turn.turn })}</Text>
            <Text style={[styles.logTime, { color: colors.faint }]}>{fightClock(view, turn.at)}</Text>
          </View>
          {order.map((i) => {
            const side = turn.sides[i];
            const notes = sideNotes(side, t, tf)
              .map((n) => n.text)
              .join(' · ');
            return (
              <View key={i} style={styles.logRow}>
                {side.play.kind === 'card' ? (
                  <CardChip card={side.play.card} as={side.play.as} />
                ) : (
                  <View style={[styles.logNoCard, { borderColor: colors.line }]}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>—</Text>
                  </View>
                )}
                <View style={styles.logText}>
                  <Text style={[styles.logWho, { color: colors.text }]} numberOfLines={2}>
                    <Text style={{ fontWeight: '800' }}>{i === me ? t('prop.you') : fighterName(view.fighters[i], t)}</Text>
                    {' · '}
                    {playTitle(side, t)}
                  </Text>
                  {!!notes && (
                    <Text style={[styles.logNotes, { color: colors.muted }]} numberOfLines={3}>
                      {notes}
                    </Text>
                  )}
                </View>
                <View style={styles.logHp}>
                  {side.taken > 0 && <Text style={[styles.logTaken, { color: colors.down }]}>−{side.taken}</Text>}
                  <Text style={[styles.logHpText, { color: colors.text }]}>{Math.max(0, side.hp)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// -------------------------------------------------------------------- chart

/** Health of both fighters turn by turn. */
export function HpChart({ view, width, step }: { view: KombatView; width: number; step?: number | null }) {
  const { colors, scheme, t } = useStore();
  const height = 96;
  const pad = { l: 6, r: 8, t: 8, b: 8 };
  const turns = Math.max(view.maxTurns, view.log.length);
  const x = (i: number) => pad.l + (i / turns) * (width - pad.l - pad.r);
  const y = (hp: number) => pad.t + (1 - Math.max(0, hp) / KOMBAT_MAX_HP) * (height - pad.t - pad.b);
  const series = ([0, 1] as const).map((side) => [KOMBAT_MAX_HP, ...view.log.map((turn) => turn.sides[side].hp)]);
  const color = (side: 0 | 1) => (view.fighters[side] ? worldColor(view.fighters[side]!.character, scheme) : colors.muted);
  if (width <= 0) return null;
  return (
    <View accessibilityLabel={t('kombat.hpChart')}>
      <Svg width={width} height={height}>
        {[0, 50, 100].map((v) => (
          <Line key={v} x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={colors.line} strokeWidth={1} strokeDasharray={v === 0 ? undefined : '3 4'} />
        ))}
        {step != null && step > 0 && <Line x1={x(step)} x2={x(step)} y1={pad.t} y2={height - pad.b} stroke={colors.goldText} strokeWidth={1.5} />}
        {([0, 1] as const).map((side) => (
          <Polyline
            key={side}
            points={series[side].map((hp, i) => `${x(i).toFixed(1)},${y(hp).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={color(side)}
            strokeWidth={side === view.you ? 2.6 : 1.8}
            strokeLinejoin="round"
          />
        ))}
        {([0, 1] as const).map((side) => {
          const last = series[side].length - 1;
          const i = step != null ? Math.min(step, last) : last;
          return <Circle key={`d${side}`} cx={x(i)} cy={y(series[side][i])} r={3.5} fill={color(side)} />;
        })}
      </Svg>
    </View>
  );
}

// ------------------------------------------------------------------ replay

/** The fight again, turn by turn: the cards on the table, both fighters as they were, the log up to that turn. */
export function KombatReplay({ view, width }: { view: KombatView; width: number }) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf, haptic } = useStore();
  const total = view.log.length;
  const [step, setStep] = useState(total);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setStep((s) => Math.min(total, s + 1)), 1300);
    return () => clearTimeout(id);
  }, [playing, step, total]);

  const me = view.you;
  const them = (me === 0 ? 1 : 0) as 0 | 1;
  const turn = step > 0 ? view.log[step - 1] : null;
  const go = (s: number) => {
    haptic('tap');
    setPlaying(false);
    setStep(Math.max(0, Math.min(total, s)));
  };
  return (
    <View style={styles.replay}>
      {view.fighters[them] && <FighterRow f={view.fighters[them]!} snap={snapshotAt(view, them, step)} name={fighterName(view.fighters[them], t)} />}
      <TurnTable turn={turn} view={view} width={width} />
      <FighterRow f={view.fighters[me]!} snap={snapshotAt(view, me, step)} name="" mine />
      <HpChart view={view} width={width} step={step} />
      <View style={styles.controls}>
        <Control label="⏮" a11y={t('replay.start')} onPress={() => go(0)} />
        <Control label="◀" a11y={t('replay.back')} onPress={() => go(step - 1)} />
        <Control
          label={playing ? '❚❚' : '▶'}
          a11y={playing ? t('replay.pause') : t('replay.play')}
          onPress={() => {
            haptic('tap');
            if (!playing && step >= total) setStep(0);
            setPlaying((p) => !p);
          }}
          main
        />
        <Control label="▶|" a11y={t('replay.next')} onPress={() => go(step + 1)} />
        <Control label="⏭" a11y={t('replay.end')} onPress={() => go(total)} />
      </View>
      <Text style={[styles.replayStep, { color: colors.muted }]}>{step === 0 ? t('kombat.firstTurn') : tf('replay.step', { n: step, max: total })}</Text>
    </View>
  );
}

function Control({ label, a11y, onPress, main }: { label: string; a11y: string; onPress: () => void; main?: boolean }) {
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
  fighter: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  fighterBody: { flex: 1, minWidth: 0, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  charName: { fontFamily: fonts.display, fontSize: 19, flexShrink: 1 },
  nick: { fontSize: 12, flexShrink: 1 },
  flash: { position: 'absolute', left: 0, top: 0, width: 58, height: 58, borderRadius: 29 },
  damage: { position: 'absolute', alignSelf: 'center', top: 4, fontSize: 22, fontWeight: '900' },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  meterText: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 58, justifyContent: 'flex-end' },
  meterValue: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pipLabel: { fontSize: 11, marginRight: 2 },
  pip: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  effect: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  effectText: { fontSize: 11, fontWeight: '700' },
  table: { flexDirection: 'row', alignItems: 'flex-start', borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: space.sm, gap: space.sm },
  half: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
  halfWho: { fontSize: 12, fontWeight: '700' },
  tableMid: { alignItems: 'center', paddingTop: 50, minWidth: 44 },
  tableTurn: { fontSize: 13, fontWeight: '800' },
  tableTime: { fontSize: 11, fontVariant: ['tabular-nums'] },
  noCard: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, alignItems: 'center', justifyContent: 'center', padding: 6 },
  noCardText: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  notes: { alignItems: 'center', gap: 1, alignSelf: 'stretch' },
  playName: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  taken: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  note: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  log: { gap: space.sm },
  logTurn: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: 6 },
  logHead: { flexDirection: 'row', justifyContent: 'space-between' },
  logTurnText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  logTime: { fontSize: 12, fontVariant: ['tabular-nums'] },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  logNoCard: { width: 42, height: 22, borderWidth: 1, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  logText: { flex: 1, minWidth: 0 },
  logWho: { fontSize: 13 },
  logNotes: { fontSize: 12, marginTop: 1 },
  logHp: { alignItems: 'flex-end', minWidth: 40 },
  logTaken: { fontSize: 12, fontWeight: '800' },
  logHpText: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  replay: { gap: space.md },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  control: { width: 46, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  controlMain: { width: 58 },
  controlText: { fontSize: 15, fontWeight: '800' },
  replayStep: { fontSize: 12, textAlign: 'center' },
});
