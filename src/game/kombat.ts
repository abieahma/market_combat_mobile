// Market Kombat: turn-based card fights between the characters of the universes.
//
// Pure, deterministic rules with no React or platform imports, so the server
// plays the turns out with exactly the same code.
//
// Every fighter has an own deck of 53 cards, shuffled by the fight seed: four
// suits (one per universe) of 13 cards and one joker. Five cards are in hand.
// Each turn both fighters play one card at the same time without seeing the
// other's; then the turn is resolved and each draws a new card.
//
//   2 4 6 8 10  attacks: the higher, the harder
//   3 5 7 9     defences: absorb damage this turn; the 9 also hits back
//   J           combo boost: +2 combo, but a hit while boosting breaks it
//   Q           heal or a shield for two turns, by suit
//   K           the suit's trick: stun, poison, energy theft, around defences
//   A           the universe's super move
//   joker       any card the fighter names
//
// A higher card costs more energy. Cards of the fighter's own universe are
// 25 % stronger. Two cards of one suit in a row add a combo level; an attack
// spends the combo, +25 % per level. Instead of a card a fighter may rest:
// more energy, and one card of the hand may be swapped for a new one.
//
// The numbers are placeholders until balancing.

import { CHARACTER_IDS, KOMBAT_JOKER, KOMBAT_RANKS } from '../api/contract';
import type { CharacterId, KombatCardId, KombatEffect, KombatPlay, KombatPlayed, KombatRank, KombatTurnSide, KombatTurnView } from '../api/contract';
import { nextFloat, nextInt, RngState, seedFrom } from './rng';

/** Version of the rules. Fights of older rules are not continued. */
export const KOMBAT_RULES = 2;
export const KOMBAT_MAX_HP = 100;
export const KOMBAT_MAX_ENERGY = 100;
export const KOMBAT_START_ENERGY = 30;
export const KOMBAT_REGEN = 10;
export const KOMBAT_BOOSTED_REGEN = 20;
/** Extra energy for a rest instead of a card. */
export const KOMBAT_REST_ENERGY = 15;
export const KOMBAT_HAND = 5;
export const KOMBAT_COMBO_MAX = 4;
/** Each combo level adds this share to the next attack. */
export const KOMBAT_COMBO_BONUS = 0.25;
/** Cards of the fighter's own universe are this much stronger. */
export const KOMBAT_OWN_SUIT = 1.25;
/** Extra damage taken while boosting a combo (J). */
export const KOMBAT_CAUGHT_BONUS = 0.25;
/** Combo levels a J adds. */
export const KOMBAT_BOOST_COMBO = 2;
export const KOMBAT_CRIT_CHANCE = 0.1;
export const KOMBAT_CRIT = 1.5;
export const KOMBAT_SHIELD_TURNS = 2;
export const KOMBAT_POISON_TURNS = 3;
export const KOMBAT_TURN_MS = 20_000;
export const KOMBAT_MAX_TURNS = 20;

// -------------------------------------------------------------------- cards

export type CardKind = 'attack' | 'defense' | 'boost' | 'queen' | 'king' | 'ace';

export interface CardDef {
  id: KombatCardId;
  suit: CharacterId;
  rank: KombatRank;
  kind: CardKind;
  cost: number;
  damage: number;
  absorb: number;
  /** Damage back to an attacker (the 9). */
  counter: number;
  combo: number;
  heal: number;
  /** Absorbed each turn for KOMBAT_SHIELD_TURNS turns. */
  shield: number;
  /** Taken each turn for KOMBAT_POISON_TURNS turns. */
  poison: number;
  stun: boolean;
  /** Energy taken from the opponent. */
  steal: number;
  /** Goes around defences and shields. */
  pierce: boolean;
}

type Effects = Partial<Pick<CardDef, 'damage' | 'absorb' | 'counter' | 'combo' | 'heal' | 'shield' | 'poison' | 'stun' | 'steal' | 'pierce'>>;

/** Number cards: [kind, cost, effects]. */
const NUMBERS: Partial<Record<KombatRank, [CardKind, number, Effects]>> = {
  '2': ['attack', 0, { damage: 6 }],
  '3': ['defense', 0, { absorb: 6 }],
  '4': ['attack', 5, { damage: 9 }],
  '5': ['defense', 5, { absorb: 10 }],
  '6': ['attack', 10, { damage: 12 }],
  '7': ['defense', 10, { absorb: 14 }],
  '8': ['attack', 15, { damage: 15 }],
  '9': ['defense', 15, { absorb: 16, counter: 6 }],
  '10': ['attack', 20, { damage: 18 }],
  J: ['boost', 10, { combo: KOMBAT_BOOST_COMBO }],
};

/** Face cards differ by suit: each universe fights in its own way. */
const FACES: Record<'Q' | 'K' | 'A', [number, Record<CharacterId, Effects>]> = {
  Q: [
    20,
    {
      waldberik: { shield: 10 }, // Tight Packing
      ozonik: { heal: 18 }, // Free Return
      avitos: { shield: 10 }, // Safe Deal
      yandos: { heal: 18 }, // Cashback
    },
  ],
  K: [
    30,
    {
      waldberik: { damage: 8, stun: true }, // Warehouse Jam: the opponent skips a turn
      ozonik: { damage: 6, poison: 5 }, // Expired Goods: poison for three turns
      avitos: { damage: 8, steal: 20 }, // Haggle: takes energy
      yandos: { damage: 14, pierce: true }, // Detour: around any defence
    },
  ],
  A: [
    40,
    {
      waldberik: { damage: 30 }, // Parcel Avalanche
      ozonik: { damage: 22, heal: 12 }, // Robot Packer
      avitos: { damage: 20, steal: 25 }, // Hard Bargain
      yandos: { damage: 24, pierce: true }, // Smart Route
    },
  ],
};

const BLANK: Required<Effects> = { damage: 0, absorb: 0, counter: 0, combo: 0, heal: 0, shield: 0, poison: 0, stun: false, steal: 0, pierce: false };

function build(suit: CharacterId, rank: KombatRank): CardDef {
  const number = NUMBERS[rank];
  if (number) {
    const [kind, cost, fx] = number;
    return { id: `${suit}-${rank}`, suit, rank, kind, cost, ...BLANK, ...fx };
  }
  const face = rank as 'Q' | 'K' | 'A';
  const [cost, bySuit] = FACES[face];
  const kind: CardKind = face === 'Q' ? 'queen' : face === 'K' ? 'king' : 'ace';
  return { id: `${suit}-${rank}`, suit, rank, kind, cost, ...BLANK, ...bySuit[suit] };
}

const CARDS: Record<KombatCardId, CardDef> = {};
for (const suit of CHARACTER_IDS) for (const rank of KOMBAT_RANKS) CARDS[`${suit}-${rank}`] = build(suit, rank);

/** All 52 suit cards, suit by suit. */
export const SUIT_CARDS: KombatCardId[] = Object.keys(CARDS);
/** The full deck: 52 suit cards and the joker. */
export const DECK: KombatCardId[] = [...SUIT_CARDS, KOMBAT_JOKER];

export function isSuitCard(id: unknown): id is KombatCardId {
  return typeof id === 'string' && id in CARDS;
}

/** The card's rules; the joker has none until it names a card. */
export function cardDef(id: KombatCardId): CardDef {
  const def = CARDS[id];
  if (!def) throw new Error(`Unknown card ${id}`);
  return def;
}

/** A card's effect for a fighter: own-suit cards are KOMBAT_OWN_SUIT stronger. */
export function scaled(def: CardDef, character: CharacterId): CardDef {
  if (def.suit !== character) return def;
  const k = (v: number) => Math.round(v * KOMBAT_OWN_SUIT);
  return {
    ...def,
    damage: k(def.damage),
    absorb: k(def.absorb),
    counter: k(def.counter),
    heal: k(def.heal),
    shield: k(def.shield),
    poison: k(def.poison),
    steal: k(def.steal),
  };
}

/** The card a play works as: the card itself, or what the joker became. */
export function playedCard(play: KombatPlay | KombatPlayed | null): KombatCardId | null {
  if (!play || play.kind !== 'card') return null;
  return play.card === KOMBAT_JOKER ? (play.as ?? null) : play.card;
}

// ------------------------------------------------------------------ fighters

export interface KombatFighter {
  character: CharacterId;
  hp: number;
  energy: number;
  combo: number;
  boosted: boolean;
  hand: KombatCardId[];
  /** Cards still to draw, top first. */
  deck: KombatCardId[];
  /** Suit of the previous card; a rest or a skipped turn clears it. */
  lastSuit: CharacterId | null;
  effects: KombatEffect[];
}

export interface KombatState {
  rules: number;
  seed: number;
  rng: RngState;
  /** Separate stream for the computer's choices, so they do not shift the fight's rolls. */
  botRng: RngState;
  /** Next turn to be played, from 1. */
  turn: number;
  fighters: [KombatFighter, KombatFighter];
  log: KombatTurnView[];
  finished: boolean;
  /** Index of the winner, null for a draw; undefined while the fight goes on. */
  winner?: 0 | 1 | null;
  reason?: 'ko' | 'turns' | 'forfeit';
}

/** The deck of fighter `side`, shuffled by the fight seed (Fisher–Yates). */
export function shuffledDeck(seed: number, side: 0 | 1): KombatCardId[] {
  let rng = seedFrom(`deck:${seed}:${side}`);
  const cards = [...DECK];
  for (let i = cards.length - 1; i > 0; i--) {
    let j: number;
    [j, rng] = nextInt(rng, 0, i);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function createKombat(
  seed: number,
  a: { character: CharacterId; boosted?: boolean },
  b: { character: CharacterId; boosted?: boolean },
): KombatState {
  const fighter = (f: { character: CharacterId; boosted?: boolean }, side: 0 | 1): KombatFighter => {
    const deck = shuffledDeck(seed, side);
    return {
      character: f.character,
      hp: KOMBAT_MAX_HP,
      energy: KOMBAT_START_ENERGY,
      combo: 0,
      boosted: !!f.boosted,
      hand: deck.slice(0, KOMBAT_HAND),
      deck: deck.slice(KOMBAT_HAND),
      lastSuit: null,
      effects: [],
    };
  };
  return {
    rules: KOMBAT_RULES,
    seed,
    rng: seed >>> 0,
    botRng: seedFrom(`bot:${seed}`),
    turn: 1,
    fighters: [fighter(a, 0), fighter(b, 1)],
    log: [],
    finished: false,
  };
}

export function isStunned(f: KombatFighter): boolean {
  return f.effects.some((e) => e.kind === 'stun');
}

/** Why a play is not allowed, or null if it is. */
export function playProblem(f: KombatFighter, play: KombatPlay): 'not_in_hand' | 'joker' | 'energy' | null {
  if (play.kind === 'rest') return play.discard === undefined || f.hand.includes(play.discard) ? null : 'not_in_hand';
  if (!f.hand.includes(play.card)) return 'not_in_hand';
  const card = playedCard(play);
  if (!isSuitCard(card)) return 'joker';
  return cardDef(card).cost > f.energy ? 'energy' : null;
}

export function canPlay(f: KombatFighter, play: KombatPlay): boolean {
  return playProblem(f, play) === null;
}

// -------------------------------------------------------------------- a turn

function withEffect(effects: KombatEffect[], add: KombatEffect): KombatEffect[] {
  const have = effects.find((e) => e.kind === add.kind);
  if (!have) return [...effects, add];
  return effects.map((e) => (e === have ? { kind: e.kind, amount: Math.max(e.amount, add.amount), turns: Math.max(e.turns, add.turns) } : e));
}

function draw(f: KombatFighter, used: KombatCardId | null): Pick<KombatFighter, 'hand' | 'deck'> {
  if (used === null) return { hand: f.hand, deck: f.deck };
  const at = f.hand.indexOf(used);
  if (at < 0) return { hand: f.hand, deck: f.deck };
  const hand = [...f.hand.slice(0, at), ...f.hand.slice(at + 1)];
  const [top, ...deck] = f.deck;
  return { hand: top === undefined ? hand : [...hand, top], deck };
}

/**
 * Plays one turn out. `chosen[i]` is fighter i's play, or null if they did
 * not choose in time. A stunned fighter skips the turn whatever was chosen;
 * a play that is not allowed counts as a missed turn. `at` is the server
 * time, kept in the log.
 */
export function resolveTurn(state: KombatState, chosen: [KombatPlay | null, KombatPlay | null], at = 0): KombatState {
  if (state.finished) return state;
  const f = state.fighters;
  const sides = [0, 1] as const;
  const other = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0);

  const played = sides.map((i): KombatPlayed => {
    if (isStunned(f[i])) return { kind: 'stunned' };
    const p = chosen[i];
    if (!p || !canPlay(f[i], p)) return { kind: 'timeout' };
    if (p.kind === 'rest') return { kind: 'rest', discarded: p.discard !== undefined };
    return p.card === KOMBAT_JOKER ? { kind: 'card', card: p.card, as: p.as } : { kind: 'card', card: p.card };
  }) as [KombatPlayed, KombatPlayed];
  const cards = sides.map((i) => playedCard(played[i])) as [KombatCardId | null, KombatCardId | null];
  const defs = sides.map((i) => (cards[i] ? scaled(cardDef(cards[i]!), f[i].character) : null)) as [CardDef | null, CardDef | null];

  const out = sides.map(
    (i): KombatTurnSide => ({
      play: played[i],
      card: cards[i],
      cost: defs[i]?.cost ?? 0,
      ownSuit: !!defs[i] && defs[i]!.suit === f[i].character,
      chain: false,
      comboUsed: 0,
      attack: 0,
      crit: false,
      dealt: 0,
      absorbed: 0,
      counter: 0,
      poison: 0,
      healed: 0,
      stole: 0,
      caught: false,
      applied: [],
      taken: 0,
      hp: f[i].hp,
      energy: f[i].energy,
      combo: f[i].combo,
      effects: [],
    }),
  ) as [KombatTurnSide, KombatTurnSide];

  const combo = [f[0].combo, f[1].combo];
  const energy = [f[0].energy, f[1].energy];
  const lastSuit: [CharacterId | null, CharacterId | null] = [null, null];
  // A stun is served by skipping this turn; it goes away now.
  const effects = sides.map((i) => f[i].effects.filter((e) => e.kind !== 'stun')) as [KombatEffect[], KombatEffect[]];

  // Cards are paid for; a suit played twice in a row adds a combo level; a queen's shield goes up at once.
  for (const i of sides) {
    const d = defs[i];
    if (!d) continue;
    energy[i] -= d.cost;
    if (f[i].lastSuit === d.suit) {
      out[i].chain = true;
      combo[i] = Math.min(KOMBAT_COMBO_MAX, combo[i] + 1);
    }
    lastSuit[i] = d.suit;
    if (d.shield > 0) {
      const shield: KombatEffect = { kind: 'shield', amount: d.shield, turns: KOMBAT_SHIELD_TURNS };
      effects[i] = withEffect(effects[i], shield);
      out[i].applied.push(shield);
    }
  }

  // What each fighter can absorb this turn: the defence card and a shield.
  const shieldOf = (i: 0 | 1) => effects[i].find((e) => e.kind === 'shield')?.amount ?? 0;
  const pool = sides.map((i) => (defs[i]?.kind === 'defense' ? defs[i]!.absorb : 0) + shieldOf(i));

  // Attacks. A crit is rolled for both fighters every turn, so the stream stays in step.
  let rng = state.rng;
  for (const i of sides) {
    const j = other(i);
    let roll: number;
    [roll, rng] = nextFloat(rng);
    const d = defs[i];
    if (!d || d.damage <= 0) continue;
    let damage = d.damage * (1 + KOMBAT_COMBO_BONUS * combo[i]);
    out[i].comboUsed = combo[i];
    combo[i] = 0;
    if (defs[j]?.kind === 'boost') damage *= 1 + KOMBAT_CAUGHT_BONUS;
    out[i].crit = roll < KOMBAT_CRIT_CHANCE;
    if (out[i].crit) damage *= KOMBAT_CRIT;
    damage = Math.round(damage);
    const absorbed = d.pierce ? 0 : Math.min(pool[j], damage);
    pool[j] -= absorbed;
    out[j].absorbed += absorbed;
    out[i].attack = damage;
    out[i].dealt = damage - absorbed;
  }

  // The 9 hits back at whoever attacked it; only a shield can soften that.
  for (const i of sides) {
    const j = other(i);
    const d = defs[i];
    if (!d || d.counter <= 0 || !defs[j] || defs[j]!.damage <= 0) continue;
    const absorbed = Math.min(pool[j], d.counter);
    pool[j] -= absorbed;
    out[j].absorbed += absorbed;
    out[i].counter = d.counter - absorbed;
  }

  // Tricks work when the hit got through. A fighter who skipped this turn is not stunned again.
  for (const i of sides) {
    const j = other(i);
    const d = defs[i];
    if (!d || out[i].dealt <= 0) continue;
    if (d.stun && played[j].kind !== 'stunned') {
      const stun: KombatEffect = { kind: 'stun', amount: 0, turns: 1 };
      effects[j] = withEffect(effects[j], stun);
      out[i].applied.push(stun);
    }
    if (d.poison > 0) {
      const poison: KombatEffect = { kind: 'poison', amount: d.poison, turns: KOMBAT_POISON_TURNS };
      effects[j] = withEffect(effects[j], poison);
      out[i].applied.push(poison);
    }
  }

  // Energy: theft from what is left after paying, then the turn's regeneration.
  const stolen = sides.map((i) => {
    const d = defs[i];
    return d && d.steal > 0 && out[i].dealt > 0 ? Math.min(d.steal, Math.max(0, energy[other(i)])) : 0;
  });
  for (const i of sides) {
    out[i].stole = stolen[i];
    const regen = (f[i].boosted ? KOMBAT_BOOSTED_REGEN : KOMBAT_REGEN) + (played[i].kind === 'rest' ? KOMBAT_REST_ENERGY : 0);
    energy[i] = Math.max(0, Math.min(KOMBAT_MAX_ENERGY, energy[i] - stolen[other(i)] + stolen[i] + regen));
  }

  // Health: hits, counters and poison; healing only for a fighter still standing.
  for (const i of sides) {
    const j = other(i);
    const poison = effects[i].find((e) => e.kind === 'poison');
    out[i].poison = poison?.amount ?? 0;
    out[i].taken = out[j].dealt + out[j].counter + out[i].poison;
    let hp = f[i].hp - out[i].taken;
    const heal = defs[i]?.heal ?? 0;
    if (hp > 0 && heal > 0) {
      out[i].healed = Math.min(heal, KOMBAT_MAX_HP - hp);
      hp += out[i].healed;
    }
    out[i].hp = hp;
  }

  // A combo boost (J) holds only if no hit got through.
  for (const i of sides) {
    if (defs[i]?.kind !== 'boost') continue;
    const j = other(i);
    if (out[j].dealt > 0) {
      out[i].caught = true;
      combo[i] = 0;
    } else combo[i] = Math.min(KOMBAT_COMBO_MAX, combo[i] + defs[i]!.combo);
  }

  // Lasting effects count down; a stun put on this turn waits for the next one.
  const next = sides.map((i): KombatFighter => {
    const left = effects[i]
      .map((e) => (e.kind === 'stun' ? e : { ...e, turns: e.turns - 1 }))
      .filter((e) => e.turns > 0);
    const p = chosen[i];
    const used = played[i].kind === 'card' ? (p as { card: KombatCardId }).card : played[i].kind === 'rest' && p?.kind === 'rest' ? (p.discard ?? null) : null;
    out[i].energy = energy[i];
    out[i].combo = combo[i];
    out[i].effects = left;
    return { ...f[i], hp: out[i].hp, energy: energy[i], combo: combo[i], lastSuit: lastSuit[i], effects: left, ...draw(f[i], used) };
  }) as [KombatFighter, KombatFighter];

  let result: KombatState = {
    ...state,
    rng,
    fighters: next,
    log: [...state.log, { turn: state.turn, at, sides: out }],
    turn: state.turn + 1,
  };
  // Health may go below zero: when both fall in one turn, the one who fell less wins.
  const [a, b] = next;
  const leader = a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1;
  if (a.hp <= 0 || b.hp <= 0) result = finish(result, leader, 'ko');
  else if (state.turn >= KOMBAT_MAX_TURNS) result = finish(result, leader, 'turns');
  return result;
}

function finish(state: KombatState, winner: 0 | 1 | null, reason: 'ko' | 'turns' | 'forfeit'): KombatState {
  return { ...state, finished: true, winner, reason };
}

/** The fighter at `loser` leaves the fight: the other one wins. */
export function forfeit(state: KombatState, loser: 0 | 1): KombatState {
  if (state.finished) return state;
  return finish(state, loser === 0 ? 1 : 0, 'forfeit');
}

// ---------------------------------------------------------------- computer

/** Cards the computer considers for its joker: the strongest of its own suit. */
function jokerChoices(f: KombatFighter): KombatCardId[] {
  return (['A', 'K', 'Q', '10', '9'] as KombatRank[]).map((r) => `${f.character}-${r}`);
}

/** How much the computer likes a card right now; higher is better. */
function scoreCard(def: CardDef, me: KombatFighter, them: KombatFighter): number {
  const chain = me.lastSuit === def.suit ? 1 : 0;
  const threat = them.combo >= 2 || them.energy >= 40;
  switch (def.kind) {
    case 'attack':
    case 'king':
    case 'ace': {
      let score = def.damage * (1 + KOMBAT_COMBO_BONUS * Math.min(KOMBAT_COMBO_MAX, me.combo + chain));
      if (score >= them.hp) score += 100;
      if (def.pierce) score += 3;
      if (def.stun) score += 7;
      if (def.poison) score += def.poison * 2;
      if (def.steal) score += def.steal / 4;
      return score;
    }
    case 'defense':
      return (def.absorb + def.counter) * (threat ? 1 : 0.55);
    case 'boost':
      return me.combo < 2 ? 10 : 2;
    case 'queen':
      if (def.heal) return me.hp < 65 ? def.heal : 3;
      return me.hp < 75 ? 13 : 5;
  }
}

/** The computer's play for fighter `side`: sensible, a little unpredictable, the same for the same state. */
export function botPlay(state: KombatState, side: 0 | 1): { play: KombatPlay; state: KombatState } {
  const me = state.fighters[side];
  const them = state.fighters[side === 0 ? 1 : 0];
  let botRng = state.botRng;
  let best: { play: KombatPlay; score: number } | null = null;
  for (const card of me.hand) {
    const options = card === KOMBAT_JOKER ? jokerChoices(me) : [card];
    for (const option of options) {
      const def = scaled(cardDef(option), me.character);
      if (def.cost > me.energy) continue;
      let noise: number;
      [noise, botRng] = nextFloat(botRng);
      const score = scoreCard(def, me, them) - def.cost * 0.1 + noise * 8;
      if (!best || score > best.score) best = { play: card === KOMBAT_JOKER ? { kind: 'card', card, as: option } : { kind: 'card', card }, score };
    }
  }
  if (best) return { play: best.play, state: { ...state, botRng } };
  // Nothing affordable: rest and swap the dearest card.
  const dearest = [...me.hand].filter((c) => c !== KOMBAT_JOKER).sort((x, y) => cardDef(y).cost - cardDef(x).cost)[0];
  return { play: dearest ? { kind: 'rest', discard: dearest } : { kind: 'rest' }, state: { ...state, botRng } };
}
