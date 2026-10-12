// A Market Kombat fight. The screen asks the server for the fight every
// moment: moves are chosen within the turn timer, the opponent's choice stays
// hidden, and when the server plays the turn out both fighters see it here.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { KombatFighterView, KombatMove, KombatView } from '../api/contract';
import { isApiError } from '../api/transport';
import { Avatar } from '../components/Avatar';
import { GAMES } from '../games';
import { SPECIALS } from '../game/kombat';
import { StringKey } from '../i18n/strings';
import { api, useStore } from '../state/store';
import { AbieAmount, Button } from '../ui/kit';
import { Glass, useReducedMotion } from '../ui/luxe';
import { fonts, radius, space, type } from '../ui/theme';
import { characterName, worldColor } from '../world/characters';

const POLL_MS = 700;
const native = Platform.OS !== 'web';
const MOVE_LABEL: Record<KombatMove, StringKey> = { strike: 'kombat.strike', special: 'kombat.strike', block: 'kombat.block', charge: 'kombat.charge' };
const money = GAMES.find((g) => g.id === 'kombat')!.money;

export function KombatScreen({ fightId, onHub, onAgain }: { fightId: string; onHub: () => void; onAgain: () => void }) {
  const { colors, t, tf, fmt, scheme, refresh, notify, haptic } = useStore();
  const [view, setView] = useState<KombatView | null>(null);
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  const [sending, setSending] = useState(false);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const lastTurn = useRef(0);
  const settled = useRef(false);
  const reduced = useReducedMotion();
  const hit = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  const lunge = useRef([new Animated.Value(0), new Animated.Value(0)]).current;

  const take = useCallback((v: KombatView) => {
    setView(v);
    setOffset(v.serverNow - Date.now());
  }, []);

  // Ask the server for the fight until it is over.
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.kombat
        .get(fightId)
        .then((v) => alive && take(v))
        .catch(() => {});
    load();
    const id = setInterval(() => {
      if (view && (view.status === 'finished' || view.status === 'cancelled')) return;
      load();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [fightId, take, view?.status]);

  // The timer on screen.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!leaveArmed) return;
    const id = setTimeout(() => setLeaveArmed(false), 2500);
    return () => clearTimeout(id);
  }, [leaveArmed]);

  // A turn was played: the attackers lunge, whoever was hit shakes.
  useEffect(() => {
    const last = view?.last;
    if (!last || last.turn === lastTurn.current) return;
    lastTurn.current = last.turn;
    const mine = view!.you;
    if (last.damage[mine] > 0) haptic('warning');
    if (reduced) return;
    for (const i of [0, 1] as const) {
      const attacked = last.moves[i] === 'strike' || last.moves[i] === 'special';
      if (attacked) {
        Animated.sequence([
          Animated.timing(lunge[i], { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: native }),
          Animated.timing(lunge[i], { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: native }),
        ]).start();
      }
      if (last.damage[i] > 0) {
        hit[i].setValue(0);
        Animated.timing(hit[i], { toValue: 1, duration: 520, easing: Easing.linear, useNativeDriver: native }).start();
      }
    }
  }, [view, reduced, haptic, hit, lunge]);

  // Once settled, the wallet on the other screens is brought up to date.
  useEffect(() => {
    if (!view || settled.current) return;
    if (view.status === 'finished' || view.status === 'cancelled') {
      settled.current = true;
      haptic(view.settlement?.winner === view.you ? 'success' : 'tap');
      refresh();
    }
  }, [view, refresh, haptic]);

  if (!view) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  const me = view.you;
  const them = (me === 0 ? 1 : 0) as 0 | 1;
  const myFighter = view.fighters[me]!;
  const theirFighter = view.fighters[them];
  const special = SPECIALS[myFighter.character];
  const left = view.deadline ? Math.max(0, Math.ceil((view.deadline - (Date.now() + offset)) / 1000)) : 0;
  const active = view.status === 'active';
  const nameOf = (f: KombatFighterView | null) => (f ? (f.isBot ? t('kombat.computer') : f.nickname) : '');
  const moveName = (f: KombatFighterView, m: KombatMove) => (m === 'special' ? t(`special.${f.character}` as StringKey) : t(MOVE_LABEL[m]));

  const choose = async (move: KombatMove) => {
    if (!active || view.myMove || sending) return;
    haptic('tap');
    setSending(true);
    try {
      take(await api.kombat.move(view.id, view.turn, move));
    } catch (e) {
      if (!(isApiError(e) && e.code === 'conflict')) notify(t('net.error'));
    } finally {
      setSending(false);
    }
  };

  const leave = async () => {
    if (!leaveArmed && view.status === 'active') {
      setLeaveArmed(true);
      return;
    }
    try {
      take(await api.kombat.leave(view.id));
    } catch {
      notify(t('net.error'));
    }
  };

  // ---------------------------------------------------------------- waiting
  if (view.status === 'waiting') {
    return (
      <View style={styles.center}>
        <Glass style={styles.waiting}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={[styles.waitTitle, { color: colors.text }]}>{t('kombat.searching')}</Text>
          <Text style={[type.body, { color: colors.muted, textAlign: 'center' }]}>{tf('kombat.searchingNote', { stake: money(fmt(view.stake)) })}</Text>
          <Button variant="ghost" label={t('kombat.cancel')} onPress={leave} />
        </Glass>
      </View>
    );
  }

  const over = view.status === 'finished' || view.status === 'cancelled';
  const s = view.settlement;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.topRow}>
        {!over ? (
          <Pressable
            accessibilityRole="button"
            onPress={leave}
            style={[styles.leave, { borderColor: leaveArmed ? colors.down : colors.line, backgroundColor: leaveArmed ? colors.downSoft : 'transparent' }]}
          >
            <Text style={[styles.leaveText, { color: leaveArmed ? colors.down : colors.muted }]} numberOfLines={1}>
              {leaveArmed ? t('kombat.leaveConfirm') : t('duel.leave')}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Text style={[styles.turn, { color: colors.muted }]}>{tf('kombat.turn', { n: Math.min(view.turn, view.maxTurns), max: view.maxTurns })}</Text>
        {active && (
          <View style={[styles.timer, { borderColor: left <= 3 ? colors.down : colors.line, backgroundColor: colors.surface }]}>
            <Text style={[styles.timerText, { color: left <= 3 ? colors.down : colors.text }]}>{left}</Text>
          </View>
        )}
      </View>

      <Glass style={styles.arena}>
        <Fighter f={myFighter} name={nameOf(myFighter)} side={0} hit={hit[me]} lunge={lunge[me]} damage={view.last?.damage[me] ?? 0} crit={view.last?.crit[me] ?? false} turn={view.last?.turn ?? 0} />
        <Text style={[styles.vs, { color: colors.goldHi }]}>VS</Text>
        {theirFighter && (
          <Fighter f={theirFighter} name={nameOf(theirFighter)} side={1} hit={hit[them]} lunge={lunge[them]} damage={view.last?.damage[them] ?? 0} crit={view.last?.crit[them] ?? false} turn={view.last?.turn ?? 0} />
        )}
      </Glass>

      {view.last && theirFighter && (
        <View style={[styles.report, { borderColor: colors.line }]}>
          <Text style={[styles.reportLine, { color: colors.text }]}>
            {t('prop.you')}: {moveName(myFighter, view.last.moves[me])}
            {view.last.damage[them] > 0 ? `  → −${view.last.damage[them]}` : ''}
          </Text>
          <Text style={[styles.reportLine, { color: colors.muted }]}>
            {nameOf(theirFighter)}: {moveName(theirFighter, view.last.moves[them])}
            {view.last.damage[me] > 0 ? `  → −${view.last.damage[me]}` : ''}
          </Text>
        </View>
      )}

      {!over && (
        <>
          <Text style={[styles.prompt, { color: view.myMove ? colors.gold : colors.text }]}>{view.myMove ? t('kombat.chosen') : t('kombat.choose')}</Text>
          <View style={styles.moves}>
            <MoveButton label={t('kombat.strike')} hint={t('kombat.strikeHint')} chosen={view.myMove === 'strike'} disabled={!!view.myMove || sending} onPress={() => choose('strike')} />
            <MoveButton
              label={t(`special.${myFighter.character}` as StringKey)}
              hint={tf('kombat.specialHint', { cost: special.cost })}
              chosen={view.myMove === 'special'}
              disabled={!!view.myMove || sending || myFighter.energy < special.cost}
              onPress={() => choose('special')}
              accent={worldColor(myFighter.character, scheme)}
            />
            <MoveButton label={t('kombat.block')} hint={t('kombat.blockHint')} chosen={view.myMove === 'block'} disabled={!!view.myMove || sending} onPress={() => choose('block')} />
            <MoveButton label={t('kombat.charge')} hint={t('kombat.chargeHint')} chosen={view.myMove === 'charge'} disabled={!!view.myMove || sending} onPress={() => choose('charge')} />
          </View>
        </>
      )}

      {over && (
        <Glass style={styles.result}>
          {view.status === 'cancelled' ? (
            <Text style={[type.body, { color: colors.text, textAlign: 'center' }]}>{t('kombat.cancelled')}</Text>
          ) : (
            <>
              <Text style={[styles.resultTitle, { color: s?.winner === me ? colors.gold : colors.text }]}>
                {s?.winner === null ? t('kombat.draw') : s?.winner === me ? t('kombat.win') : t('kombat.lose')}
              </Text>
              {view.mode === 'bot' || !s ? (
                <Text style={[type.body, { color: colors.muted, textAlign: 'center' }]}>{t('kombat.trainingDone')}</Text>
              ) : (
                <>
                  <View style={styles.payout}>
                    <Text style={[type.label, { color: colors.gold }]}>{t('result.returned')}</Text>
                    <AbieAmount amount={s.payout} size="lg" />
                  </View>
                  <Text style={[styles.net, { color: s.net > 0 ? colors.up : s.net < 0 ? colors.down : colors.muted }]}>
                    {t('result.net')}: {s.net > 0 ? '+' : s.net < 0 ? '−' : ''}
                    {fmt(Math.abs(s.net))} ABIE
                  </Text>
                  <View style={[styles.lines, { borderColor: colors.line }]}>
                    <Line label={t('result.stake')} value={money(fmt(s.stake))} />
                    <Line label={t('result.final')} value={money(fmt(s.back + s.fee))} />
                    {s.fee > 0 && <Line label={t('result.fee')} value={`−${money(fmt(s.fee))}`} />}
                  </View>
                </>
              )}
            </>
          )}
          <Button label={t('kombat.again')} onPress={onAgain} big />
          <Button label={t('result.toHub')} onPress={onHub} variant="ghost" />
        </Glass>
      )}

    </ScrollView>
  );
}

function Fighter({
  f,
  name,
  side,
  hit,
  lunge,
  damage,
  crit,
  turn,
}: {
  f: KombatFighterView;
  name: string;
  side: 0 | 1;
  hit: Animated.Value;
  lunge: Animated.Value;
  damage: number;
  crit: boolean;
  turn: number;
}) {
  const { colors, t, settings, scheme } = useStore();
  const tint = worldColor(f.character, scheme);
  const dir = side === 0 ? 1 : -1;
  const shake = hit.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 0.6, 1], outputRange: [0, -6, 6, -4, 3, 0] });
  const flash = hit.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.55, 0] });
  const rise = hit.interpolate({ inputRange: [0, 1], outputRange: [0, -26] });
  const fade = hit.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] });
  return (
    <View style={styles.fighter}>
      <Animated.View
        style={{
          transform: [{ translateX: Animated.add(lunge.interpolate({ inputRange: [0, 1], outputRange: [0, 18 * dir] }), shake) }],
        }}
      >
        <Avatar character={f.character} gender={f.gender} size={92} />
        <Animated.View pointerEvents="none" style={[styles.flash, { opacity: flash, backgroundColor: colors.down }]} />
        {damage > 0 && (
          <Animated.Text key={turn} style={[styles.damage, { color: crit ? colors.goldHi : colors.down, opacity: fade, transform: [{ translateY: rise }] }]}>
            −{damage}
            {crit ? '!' : ''}
          </Animated.Text>
        )}
      </Animated.View>
      <Text style={[styles.charName, { color: tint }]} numberOfLines={1}>
        {characterName(f.character, settings.lang)}
      </Text>
      <Text style={[styles.nick, { color: colors.muted }]} numberOfLines={1}>
        {name}
        {f.boosted ? ` · ${t('kombat.boosted')}` : ''}
      </Text>
      <Bar value={f.hp} max={100} color={f.hp > 50 ? colors.up : f.hp > 25 ? colors.gold : colors.down} />
      <Bar value={f.energy} max={100} color={tint} thin />
      <View style={styles.pips}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.pip, { borderColor: colors.gold, backgroundColor: i < f.combo ? colors.gold : 'transparent' }]} />
        ))}
      </View>
    </View>
  );
}

function Bar({ value, max, color, thin }: { value: number; max: number; color: string; thin?: boolean }) {
  const { colors } = useStore();
  return (
    <View style={[styles.bar, thin && styles.barThin, { backgroundColor: colors.surfaceAlt }]}>
      <View style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

function MoveButton({
  label,
  hint,
  chosen,
  disabled,
  onPress,
  accent,
}: {
  label: string;
  hint: string;
  chosen: boolean;
  disabled: boolean;
  onPress: () => void;
  accent?: string;
}) {
  const { colors } = useStore();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: chosen, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.move,
        {
          borderColor: chosen ? colors.gold : accent ?? colors.line,
          backgroundColor: chosen ? colors.goldSoft : colors.glass,
          opacity: disabled && !chosen ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.moveLabel, { color: chosen ? colors.gold : colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
      <Text style={[styles.moveHint, { color: colors.muted }]} numberOfLines={1}>
        {hint}
      </Text>
    </Pressable>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const { colors } = useStore();
  return (
    <View style={styles.line}>
      <Text style={[type.body, { color: colors.muted, flex: 1 }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  waiting: { padding: space.xl, gap: space.md, alignItems: 'center', alignSelf: 'stretch' },
  waitTitle: { fontFamily: fonts.display, fontSize: 28 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, minHeight: 40 },
  leave: { height: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center', flexShrink: 1 },
  leaveText: { fontSize: 13, fontWeight: '700' },
  turn: { fontSize: 13, fontWeight: '600' },
  timer: { minWidth: 44, height: 36, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  timerText: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  arena: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: space.md, gap: space.sm },
  vs: { fontFamily: fonts.display, fontSize: 30, marginTop: 30 },
  fighter: { flex: 1, alignItems: 'center', gap: 5 },
  flash: { position: 'absolute', left: 0, top: 0, width: 92, height: 92, borderRadius: 46 },
  damage: { position: 'absolute', alignSelf: 'center', top: 6, fontSize: 26, fontWeight: '900' },
  charName: { fontFamily: fonts.display, fontSize: 20, marginTop: 4 },
  nick: { fontSize: 12 },
  bar: { alignSelf: 'stretch', height: 8, borderRadius: 4, overflow: 'hidden' },
  barThin: { height: 5 },
  pips: { flexDirection: 'row', gap: 6, marginTop: 2 },
  pip: { width: 9, height: 9, borderRadius: 5, borderWidth: 1 },
  report: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: space.sm, gap: 2 },
  reportLine: { fontSize: 14, fontWeight: '600' },
  prompt: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  moves: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  move: { width: '48%', flexGrow: 1, borderWidth: 1, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 2 },
  moveLabel: { fontFamily: fonts.displaySemi, fontSize: 20 },
  moveHint: { fontSize: 11 },
  result: { padding: space.lg, gap: space.md, alignItems: 'stretch' },
  resultTitle: { fontFamily: fonts.display, fontSize: 40, textAlign: 'center' },
  net: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  lines: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: space.sm, gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineValue: { fontFamily: fonts.displaySemi, fontSize: 18, fontVariant: ['lining-nums'] },
  payout: { alignItems: 'center', gap: 4 },
});
