// Market Kombat: turn-based fights between the characters of the universes.
//
// Pure, deterministic rules with no React or platform imports, so the server
// plays the turns out with exactly the same code. Both fighters pick a move
// at the same time without seeing the other's; then the turn is resolved.
//
// The moves beat each other in a circle, so a turn is a guess about the
// opponent, not a race:
//   block  stops a strike (and gives energy back)
//   strike catches a fighter who is building a combo (and breaks it)
//   charge (building a combo) gets past a block: the next attack hits harder
//   special costs energy, hits hardest; a block only halves it
// Energy comes back every turn; a paid boost doubles that.

import type { CharacterId, KombatMove } from '../api/contract';
import { nextFloat, RngState, seedFrom } from './rng';

export const KOMBAT_MAX_HP = 100;
export const KOMBAT_MAX_ENERGY = 100;
export const KOMBAT_START_ENERGY = 30;
export const KOMBAT_REGEN = 10;
export const KOMBAT_BOOSTED_REGEN = 20;
/** Energy a fighter gets for blocking a strike. */
export const KOMBAT_BLOCK_ENERGY = 10;
export const KOMBAT_STRIKE = 10;
export const KOMBAT_COMBO_MAX = 3;
/** Each combo level adds this share to the next attack. */
export const KOMBAT_COMBO_BONUS = 0.5;
/** Extra damage taken while building a combo. */
export const KOMBAT_CAUGHT_BONUS = 0.25;
export const KOMBAT_CRIT_CHANCE = 0.1;
export const KOMBAT_CRIT = 1.5;
export const KOMBAT_TURN_MS = 12_000;
export const KOMBAT_MAX_TURNS = 20;
export const KOMBAT_MOVES: KombatMove[] = ['strike', 'special', 'block', 'charge'];

export interface Special {
  power: number;
  cost: number;
  /** none: just damage; heal: gives health back; drain: takes energy; pierce: a block does not halve it. */
  effect: 'none' | 'heal' | 'drain' | 'pierce';
  amount: number;
}

/** One special move per universe. */
export const SPECIALS: Record<CharacterId, Special> = {
  waldberik: { power: 28, cost: 50, effect: 'none', amount: 0 }, // Parcel Avalanche: the heaviest blow
  ozonik: { power: 20, cost: 40, effect: 'heal', amount: 10 }, // Robot Packing: hits and patches up
  avitos: { power: 18, cost: 35, effect: 'drain', amount: 20 }, // Hard Bargain: takes the opponent's energy
  yandos: { power: 22, cost: 45, effect: 'pierce', amount: 0 }, // Smart Route: goes around a block
};

export interface KombatFighter {
  character: CharacterId;
  hp: number;
  energy: number;
  combo: number;
  boosted: boolean;
}

export interface KombatTurn {
  turn: number;
  moves: [KombatMove, KombatMove];
  damage: [number, number];
  crit: [boolean, boolean];
  healed: [number, number];
  drained: [number, number];
}

export interface KombatState {
  seed: number;
  rng: RngState;
  /** Separate stream for the computer's choices, so they do not shift the damage rolls. */
  botRng: RngState;
  /** Next turn to be played, from 1. */
  turn: number;
  fighters: [KombatFighter, KombatFighter];
  log: KombatTurn[];
  finished: boolean;
  /** Index of the winner, null for a draw; undefined while the fight goes on. */
  winner?: 0 | 1 | null;
  reason?: 'ko' | 'turns' | 'forfeit';
}

export function createKombat(
  seed: number,
  a: { character: CharacterId; boosted?: boolean },
  b: { character: CharacterId; boosted?: boolean },
): KombatState {
  const fighter = (f: { character: CharacterId; boosted?: boolean }): KombatFighter => ({
    character: f.character,
    hp: KOMBAT_MAX_HP,
    energy: KOMBAT_START_ENERGY,
    combo: 0,
    boosted: !!f.boosted,
  });
  return {
    seed,
    rng: seed >>> 0,
    botRng: seedFrom(`bot:${seed}`),
    turn: 1,
    fighters: [fighter(a), fighter(b)],
    log: [],
    finished: false,
  };
}

export function canUse(f: KombatFighter, move: KombatMove): boolean {
  return move !== 'special' || f.energy >= SPECIALS[f.character].cost;
}

/** Plays one turn out. A special without enough energy counts as a block. */
export function resolveTurn(state: KombatState, chosen: [KombatMove, KombatMove]): KombatState {
  if (state.finished) return state;
  const f = state.fighters;
  const moves: [KombatMove, KombatMove] = [canUse(f[0], chosen[0]) ? chosen[0] : 'block', canUse(f[1], chosen[1]) ? chosen[1] : 'block'];
  let rng = state.rng;
  const damage: [number, number] = [0, 0]; // taken by fighter i
  const crit: [boolean, boolean] = [false, false];
  const healed: [number, number] = [0, 0];
  const drained: [number, number] = [0, 0]; // taken from fighter i
  const energy: [number, number] = [f[0].energy, f[1].energy];
  const combo: [number, number] = [f[0].combo, f[1].combo];

  for (const i of [0, 1] as const) {
    const j = i === 0 ? 1 : 0;
    const me = f[i];
    const move = moves[i];
    const theirs = moves[j];
    if (move !== 'strike' && move !== 'special') continue;
    const special = SPECIALS[me.character];
    let base = move === 'strike' ? KOMBAT_STRIKE : special.power;
    if (move === 'special') energy[i] -= special.cost;
    base *= 1 + KOMBAT_COMBO_BONUS * me.combo;
    combo[i] = 0;
    if (theirs === 'block') {
      if (move === 'strike') {
        base = 0;
        energy[j] += KOMBAT_BLOCK_ENERGY;
      } else if (special.effect !== 'pierce') base /= 2;
    }
    if (theirs === 'charge') base *= 1 + KOMBAT_CAUGHT_BONUS;
    // Rolls happen for every attack, blocked or not, so the stream stays in step.
    let roll: number;
    let critRoll: number;
    [roll, rng] = nextFloat(rng);
    [critRoll, rng] = nextFloat(rng);
    if (base > 0) {
      const isCrit = critRoll < KOMBAT_CRIT_CHANCE;
      crit[i] = isCrit;
      damage[j] = Math.round(base * (0.85 + roll * 0.3) * (isCrit ? KOMBAT_CRIT : 1));
    }
    if (move === 'special' && special.effect === 'heal') healed[i] = special.amount;
    if (move === 'special' && special.effect === 'drain') drained[j] = special.amount;
  }

  // Building a combo works only if nothing hit you this turn.
  for (const i of [0, 1] as const) {
    if (moves[i] === 'charge' && damage[i] === 0) combo[i] = Math.min(KOMBAT_COMBO_MAX, combo[i] + 1);
    if (moves[i] === 'charge' && damage[i] > 0) combo[i] = 0;
  }

  const next = ([0, 1] as const).map((i) => {
    const me = f[i];
    // A drain takes energy away; it cannot take more than there is.
    const taken = Math.min(drained[i], Math.max(0, energy[i]));
    drained[i] = taken;
    const e = energy[i] - taken + (me.boosted ? KOMBAT_BOOSTED_REGEN : KOMBAT_REGEN);
    // Health may go below zero: when both fall in one turn, the one who fell less wins.
    const left = me.hp - damage[i];
    if (left <= 0) healed[i] = 0;
    const hp = left > 0 ? Math.min(KOMBAT_MAX_HP, left + healed[i]) : left;
    return { ...me, hp, energy: Math.max(0, Math.min(KOMBAT_MAX_ENERGY, e)), combo: combo[i] };
  }) as [KombatFighter, KombatFighter];

  const turn: KombatTurn = { turn: state.turn, moves, damage, crit, healed, drained };
  let out: KombatState = { ...state, rng, fighters: next, log: [...state.log, turn], turn: state.turn + 1 };

  const [a, b] = next;
  if (a.hp <= 0 || b.hp <= 0) out = finish(out, a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1, 'ko');
  else if (state.turn >= KOMBAT_MAX_TURNS) out = finish(out, a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1, 'turns');
  return out;
}

function finish(state: KombatState, winner: 0 | 1 | null, reason: 'ko' | 'turns' | 'forfeit'): KombatState {
  return { ...state, finished: true, winner, reason };
}

/** The fighter at `loser` leaves the fight: the other one wins. */
export function forfeit(state: KombatState, loser: 0 | 1): KombatState {
  if (state.finished) return state;
  return finish(state, loser === 0 ? 1 : 0, 'forfeit');
}

/** The computer's move for fighter `side`: simple, a little unpredictable, same answer for the same state. */
export function botMove(state: KombatState, side: 0 | 1): { move: KombatMove; state: KombatState } {
  const me = state.fighters[side];
  const them = state.fighters[side === 0 ? 1 : 0];
  const special = SPECIALS[me.character];
  let r: number;
  let botRng = state.botRng;
  [r, botRng] = nextFloat(botRng);
  let move: KombatMove;
  if (canUse(me, 'special') && (them.hp <= special.power || r < 0.4)) move = 'special';
  else if (them.combo >= 2) move = r < 0.6 ? 'strike' : 'block';
  else if (me.combo < 2 && r < 0.55) move = r < 0.3 ? 'charge' : 'block';
  else move = r < 0.8 ? 'strike' : 'charge';
  return { move, state: { ...state, botRng } };
}
