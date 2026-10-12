// A Market Kombat fight. The screen asks the server for the fight every
// moment: a card is chosen within the turn timer, the opponent's hand and
// choice stay hidden, and when the server plays the turn out both cards turn
// over here. Every turn stays in the log below; after the fight it can be
// replayed step by step.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CHARACTER_IDS, KOMBAT_JOKER, KOMBAT_RANKS } from '../api/contract';
import type { CharacterId, KombatCardId, KombatPlay, KombatView } from '../api/contract';
import { isApiError } from '../api/transport';
import { cardEffects, cardName, KombatCard, SuitGlyph } from '../components/cards';
import { fighterName, FighterRow, HpChart, KombatReplay, snapshotAt, TurnLog, TurnTable } from '../components/KombatParts';
import { GAMES } from '../games';
import { cardDef, KOMBAT_REST_ENERGY } from '../game/kombat';
import { StringKey } from '../i18n/strings';
import { api, useStore } from '../state/store';
import { AbieAmount, Button } from '../ui/kit';
import { Glass, useReducedMotion } from '../ui/luxe';
import { fonts, radius, space } from '../ui/theme';
import { characterName } from '../world/characters';
import { useLookStyles, useType } from '../ui/look';

const POLL_MS = 700;
const native = Platform.OS !== 'web';
const KOMBAT = GAMES.find((g) => g.id === 'kombat')!;
const HAND_GAP = 8;
const RULES: StringKey[] = ['rules.1', 'rules.2', 'rules.3', 'rules.4', 'rules.5', 'rules.6', 'rules.7'];

export function KombatScreen({ fightId, onHub, onAgain }: { fightId: string; onHub: () => void; onAgain: () => void }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors, t, tf, fmt, refresh, notify, haptic, showMoney, settings } = useStore();
  const [view, setView] = useState<KombatView | null>(null);
  const [offset, setOffset] = useState(0);
  const [, setTick] = useState(0);
  const [sending, setSending] = useState(false);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [selected, setSelected] = useState<KombatCardId | null>(null);
  const [jokerAs, setJokerAs] = useState<KombatCardId | null>(null);
  const [width, setWidth] = useState(0);
  const [replay, setReplay] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const lastTurn = useRef(0);
  const settled = useRef(false);
  const reduced = useReducedMotion();
  const hit = useRef([new Animated.Value(0), new Animated.Value(0)]).current;

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

  // A turn was played: whoever was hit shakes; the choice is cleared for the next turn.
  const last = view?.log[view.log.length - 1] ?? null;
  useEffect(() => {
    if (!view || !last || last.turn === lastTurn.current) return;
    const first = lastTurn.current === 0 && view.log.length > 1;
    lastTurn.current = last.turn;
    setSelected(null);
    setJokerAs(null);
    if (first) return; // opened in the middle of a fight: nothing to animate
    if (last.sides[view.you].taken > 0) haptic('warning');
    if (reduced) return;
    for (const i of [0, 1] as const) {
      if (last.sides[i].taken <= 0) continue;
      hit[i].setValue(0);
      Animated.timing(hit[i], { toValue: 1, duration: 560, easing: Easing.linear, useNativeDriver: native }).start();
    }
  }, [view, last, reduced, haptic, hit]);

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
        <ActivityIndicator color={colors.goldText} />
      </View>
    );
  }

  const me = view.you;
  const them = (me === 0 ? 1 : 0) as 0 | 1;
  const myFighter = view.fighters[me]!;
  const theirFighter = view.fighters[them];
  const left = view.deadline ? Math.max(0, Math.ceil((view.deadline - (Date.now() + offset)) / 1000)) : 0;
  const active = view.status === 'active';
  const over = view.status === 'finished' || view.status === 'cancelled';
  const stunned = myFighter.effects.some((e) => e.kind === 'stun');
  const canAct = active && !view.myPlay && !stunned && !sending;
  const handW = width > 0 ? Math.floor((width - HAND_GAP * 4) / 5) : 0;

  const send = async (play: KombatPlay) => {
    if (!canAct) return;
    haptic('tap');
    setSending(true);
    try {
      take(await api.kombat.move(view.id, view.turn, play));
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
          <ActivityIndicator color={colors.goldText} size="large" />
          <Text style={[styles.waitTitle, { color: colors.text }]}>{t('kombat.searching')}</Text>
          <Text style={[tp.body, { color: colors.muted, textAlign: 'center' }]}>{tf('kombat.searchingNote', { stake: showMoney(KOMBAT, view.stake) })}</Text>
          <Button variant="ghost" label={t('kombat.cancel')} onPress={leave} />
        </Glass>
      </View>
    );
  }

  const s = view.settlement;
  const chosen = view.myPlay;
  const chosenCard = chosen?.kind === 'card' ? chosen.card : null;
  const prompt = !active ? null : stunned ? t('kombat.stunnedNow') : chosen ? (chosen.kind === 'rest' ? t('kombat.restChosen') : t('kombat.chosen')) : t('kombat.choose');
  const damageOf = (i: 0 | 1) => (last ? { n: last.sides[i].taken, crit: last.sides[i === 0 ? 1 : 0].crit, key: last.turn } : null);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} />
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
        <Text style={[styles.turn, { color: colors.muted }]}>{tf('kombat.turn', { n: over ? view.log.length : Math.min(view.turn, view.maxTurns), max: view.maxTurns })}</Text>
        {active && (
          <View style={[styles.timer, { borderColor: left <= 5 ? colors.down : colors.line, backgroundColor: colors.surface }]}>
            <Text style={[styles.timerText, { color: left <= 5 ? colors.down : colors.text }]}>{left}</Text>
          </View>
        )}
      </View>

      {over && (
        <Glass style={styles.result}>
          {view.status === 'cancelled' ? (
            <Text style={[tp.body, { color: colors.text, textAlign: 'center' }]}>{t('kombat.cancelled')}</Text>
          ) : (
            <>
              <Text style={[styles.resultTitle, { color: s?.winner === me ? colors.gold : colors.text }]}>
                {s?.winner === null ? t('kombat.draw') : s?.winner === me ? t('kombat.win') : t('kombat.lose')}
              </Text>
              <Text style={[tp.body, { color: colors.muted, textAlign: 'center' }]}>
                {tf(s?.reason === 'ko' ? 'kombat.byKo' : s?.reason === 'forfeit' ? 'kombat.byForfeit' : 'kombat.byTurns', { n: view.log.length })}
              </Text>
              {view.mode === 'bot' || !s ? (
                <Text style={[tp.body, { color: colors.muted, textAlign: 'center' }]}>{t('kombat.trainingDone')}</Text>
              ) : (
                <>
                  <View style={styles.payout}>
                    <Text style={[tp.label, { color: colors.goldText }]}>{t('result.returned')}</Text>
                    <AbieAmount amount={s.payout} size="lg" />
                  </View>
                  <Text style={[styles.net, { color: s.net > 0 ? colors.up : s.net < 0 ? colors.down : colors.muted }]}>
                    {t('result.net')}: {s.net > 0 ? '+' : s.net < 0 ? '−' : ''}
                    {fmt(Math.abs(s.net))} ABIE
                  </Text>
                  <View style={[styles.lines, { borderColor: colors.line }]}>
                    <Line label={t('result.stake')} value={showMoney(KOMBAT, s.stake)} />
                    <Line label={t('result.final')} value={showMoney(KOMBAT, s.back + s.fee)} />
                    {s.fee > 0 && <Line label={t('result.fee')} value={`−${showMoney(KOMBAT, s.fee)}`} />}
                  </View>
                </>
              )}
            </>
          )}
          {view.log.length > 0 && <Button label={replay ? t('replay.close') : t('kombat.replay')} onPress={() => setReplay((r) => !r)} variant="glass" />}
          <Button label={t('kombat.again')} onPress={onAgain} big />
          <Button label={t('result.toHub')} onPress={onHub} variant="ghost" />
        </Glass>
      )}

      {over && replay && width > 0 ? (
        <KombatReplay view={view} width={width} />
      ) : (
        <>
          {theirFighter && (
            <FighterRow f={theirFighter} snap={snapshotAt(view, them, null)} name={fighterName(theirFighter, t)} hit={hit[them]} damage={damageOf(them)} />
          )}
          {width > 0 && <TurnTable turn={last} view={view} width={width} pending={chosen ? t('kombat.chosenShort') : null} />}
          <FighterRow f={myFighter} snap={snapshotAt(view, me, null)} name="" mine hit={hit[me]} damage={damageOf(me)} />
        </>
      )}

      {active && (
        <>
          <Text style={[styles.prompt, { color: chosen || stunned ? colors.goldText : colors.text }]}>{prompt}</Text>

          {selected && canAct && (
            <CardDetail
              card={selected}
              jokerAs={jokerAs}
              setJokerAs={setJokerAs}
              owner={myFighter.character}
              energy={myFighter.energy}
              chain={myFighter.lastSuit}
              onPlay={(play) => send(play)}
              onClose={() => setSelected(null)}
              busy={sending}
            />
          )}

          <View style={styles.hand}>
            {handW > 0 &&
              view.hand.map((c) => {
                const def = c === KOMBAT_JOKER ? null : cardDef(c);
                const affordable = def ? def.cost <= myFighter.energy : true;
                return (
                  <KombatCard
                    key={c}
                    card={c}
                    as={c === KOMBAT_JOKER && selected === c ? jokerAs : null}
                    owner={myFighter.character}
                    width={handW}
                    selected={selected === c || chosenCard === c}
                    dim={!canAct ? chosenCard !== c : !affordable}
                    onPress={
                      canAct
                        ? () => {
                            haptic('tap');
                            setSelected((cur) => (cur === c ? null : c));
                            if (c === KOMBAT_JOKER && !jokerAs) setJokerAs(bestJoker(myFighter.character, myFighter.energy));
                          }
                        : undefined
                    }
                  />
                );
              })}
          </View>
          <Text style={[styles.handNote, { color: colors.faint }]}>
            {tf('kombat.deckLeft', { n: myFighter.deckSize })}
            {canAct && !selected ? ` · ${t('kombat.tapCard')}` : ''}
          </Text>
          {canAct && (
            <Button label={tf('kombat.rest', { n: KOMBAT_REST_ENERGY })} onPress={() => send({ kind: 'rest' })} variant="ghost" disabled={sending} />
          )}
        </>
      )}

      <Pressable accessibilityRole="button" onPress={() => setRulesOpen((o) => !o)} style={styles.rulesHead}>
        <Text style={[styles.section, { color: colors.text }]}>{t('rules.title')}</Text>
        <Text style={[styles.rulesToggle, { color: colors.goldText }]}>{rulesOpen ? '−' : '+'}</Text>
      </Pressable>
      {rulesOpen && (
        <View style={styles.rules}>
          {RULES.map((k) => (
            <Text key={k} style={[tp.body, { color: colors.muted }]}>
              {t(k)}
            </Text>
          ))}
          <Text style={[tp.body, { color: colors.muted }]}>
            {tf('rules.own', { name: characterName(myFighter.character, settings.lang) })}
          </Text>
        </View>
      )}

      {!(over && replay) && view.log.length > 0 && (
        <>
          <Text style={[styles.section, { color: colors.text }]}>{t('kombat.log')}</Text>
          {width > 0 && <HpChart view={view} width={width} />}
          <TurnLog view={view} />
        </>
      )}
    </ScrollView>
  );
}

/** The computer's sensible default for the joker: the dearest card of the own suit the energy allows. */
function bestJoker(owner: CharacterId, energy: number): KombatCardId {
  for (const r of ['A', 'K', 'Q', '10', '9', '8', '6', '4', '2']) {
    const id = `${owner}-${r}`;
    if (cardDef(id).cost <= energy) return id;
  }
  return `${owner}-2`;
}

/** The chosen card up close: what it does, what it costs, and the buttons to play or swap it. */
function CardDetail({
  card,
  jokerAs,
  setJokerAs,
  owner,
  energy,
  chain,
  onPlay,
  onClose,
  busy,
}: {
  card: KombatCardId;
  jokerAs: KombatCardId | null;
  setJokerAs: (c: KombatCardId) => void;
  owner: CharacterId;
  energy: number;
  chain: CharacterId | null;
  onPlay: (play: KombatPlay) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const styles = useLookStyles(baseStyles);
  const { colors, t, tf, settings, haptic } = useStore();
  const joker = card === KOMBAT_JOKER;
  const shown = joker ? jokerAs : card;
  const def = shown ? cardDef(shown) : null;
  const affordable = !!def && def.cost <= energy;
  const lines = shown ? cardEffects(shown, owner, t, tf) : [t('fx.joker')];
  const jokerSuit = def?.suit ?? owner;
  return (
    <Glass style={styles.detail}>
      <View style={styles.detailRow}>
        <KombatCard card={card} as={joker ? jokerAs : null} owner={owner} width={78} />
        <View style={styles.detailText}>
          <Text style={[styles.detailName, { color: colors.text }]}>{shown ? cardName(shown, t) : t('card.joker')}</Text>
          {def && (
            <Text style={[styles.detailSuit, { color: colors.muted }]}>
              {tf('kombat.suitOf', { name: characterName(def.suit, settings.lang) })}
              {def.suit === owner ? ` · ${t('kombat.ownSuit')}` : ''}
            </Text>
          )}
          {lines.map((l, i) => (
            <Text key={i} style={[styles.detailLine, { color: colors.text }]}>
              {l}
            </Text>
          ))}
          {def && (
            <Text style={[styles.detailLine, { color: affordable ? colors.muted : colors.down }]}>{tf('kombat.costOf', { n: def.cost, have: energy })}</Text>
          )}
          {def && chain === def.suit && <Text style={[styles.detailLine, { color: colors.goldText }]}>{t('kombat.chainHint')}</Text>}
        </View>
      </View>

      {joker && (
        <View style={styles.picker}>
          <Text style={[styles.pickerTitle, { color: colors.muted }]}>{t('kombat.jokerPick')}</Text>
          <View style={styles.pickRow}>
            {CHARACTER_IDS.map((suit) => (
              <Pressable
                key={suit}
                accessibilityRole="button"
                accessibilityLabel={characterName(suit, settings.lang)}
                accessibilityState={{ selected: suit === jokerSuit }}
                onPress={() => {
                  haptic('tap');
                  setJokerAs(`${suit}-${def?.rank ?? 'A'}`);
                }}
                style={[styles.pickSuit, { borderColor: suit === jokerSuit ? colors.gold : colors.line, backgroundColor: suit === jokerSuit ? colors.goldSoft : 'transparent' }]}
              >
                <SuitGlyph suit={suit} size={22} />
              </Pressable>
            ))}
          </View>
          <View style={styles.pickRanks}>
            {KOMBAT_RANKS.map((rank) => {
              const id = `${jokerSuit}-${rank}`;
              const on = id === jokerAs;
              const can = cardDef(id).cost <= energy;
              return (
                <Pressable
                  key={rank}
                  accessibilityRole="button"
                  accessibilityLabel={cardName(id, t)}
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    haptic('tap');
                    setJokerAs(id);
                  }}
                  style={[styles.pickRank, { borderColor: on ? colors.gold : colors.line, backgroundColor: on ? colors.goldSoft : 'transparent', opacity: can ? 1 : 0.45 }]}
                >
                  <Text style={[styles.pickRankText, { color: on ? colors.goldText : colors.text }]}>{rank}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.detailButtons}>
        <Button
          label={affordable ? t('kombat.play') : t('kombat.noEnergy')}
          onPress={() => shown && onPlay(joker ? { kind: 'card', card, as: shown } : { kind: 'card', card })}
          disabled={busy || !affordable}
          style={{ flex: 1 }}
        />
        <Button label={t('common.back')} onPress={onClose} variant="ghost" />
      </View>
      <Button label={tf('kombat.swap', { n: KOMBAT_REST_ENERGY })} onPress={() => onPlay({ kind: 'rest', discard: card })} variant="ghost" disabled={busy} />
    </Glass>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const styles = useLookStyles(baseStyles);
  const tp = useType();
  const { colors } = useStore();
  return (
    <View style={styles.line}>
      <Text style={[tp.body, { color: colors.muted, flex: 1 }]}>{label}</Text>
      <Text style={[styles.lineValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xl * 2 },
  waiting: { padding: space.xl, gap: space.md, alignItems: 'center', alignSelf: 'stretch' },
  waitTitle: { fontFamily: fonts.display, fontSize: 28 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, minHeight: 40, marginTop: -space.md },
  leave: { height: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center', flexShrink: 1 },
  leaveText: { fontSize: 13, fontWeight: '700' },
  turn: { fontSize: 13, fontWeight: '600' },
  timer: { minWidth: 44, height: 36, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  timerText: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  prompt: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  hand: { flexDirection: 'row', gap: HAND_GAP, justifyContent: 'center', paddingTop: 10 },
  handNote: { fontSize: 12, textAlign: 'center' },
  detail: { padding: space.md, gap: space.md },
  detailRow: { flexDirection: 'row', gap: space.md },
  detailText: { flex: 1, minWidth: 0, gap: 3 },
  detailName: { fontFamily: fonts.display, fontSize: 24, lineHeight: 26 },
  detailSuit: { fontSize: 12, marginBottom: 2 },
  detailLine: { fontSize: 14 },
  detailButtons: { flexDirection: 'row', gap: space.sm },
  picker: { gap: space.sm },
  pickerTitle: { fontSize: 12, fontWeight: '700' },
  pickRow: { flexDirection: 'row', gap: space.sm },
  pickSuit: { flex: 1, height: 40, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pickRanks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pickRank: { minWidth: 34, height: 32, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  pickRankText: { fontSize: 13, fontWeight: '800' },
  rulesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm },
  rulesToggle: { fontSize: 22, fontWeight: '700', paddingHorizontal: space.sm },
  rules: { gap: 6 },
  section: { fontFamily: fonts.displaySemi, fontSize: 22 },
  result: { padding: space.lg, gap: space.md, alignItems: 'stretch' },
  resultTitle: { fontFamily: fonts.display, fontSize: 40, textAlign: 'center' },
  net: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  lines: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: space.sm, gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineValue: { fontFamily: fonts.displaySemi, fontSize: 18, fontVariant: ['lining-nums'] },
  payout: { alignItems: 'center', gap: 4 },
});
