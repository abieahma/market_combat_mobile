// Order Picking ("Сборка заказа"): a Market Combat mini-game.
//
// The warehouse floor: an island of 16 gofras (shipping boxes) in the middle,
// gofras 1–8 in one row and 9–16 in the other; a wide aisle around it with
// room for eight pickers; 16 pre-sorts in a ring along the walls; the
// player's box of goods below the island. Goods come into the box during the
// 60-second shift. The picker takes any of them, the scanner beeps and shows
// a number for two seconds: the gofra the good goes to. A gofra holds two
// goods; a full one is taken to its own pre-sort, and an empty one with the
// same number takes its place.
//
// Pure and deterministic, with no React and no floating point in the score:
// the server plays a shift again from its seed and the player's actions and
// counts the score itself. Everyone in a room gets the same seed; slot k of
// the room plays the k-th flow of goods.

import type { OrderAction } from '../api/contract';
import { nextInt, RngState } from './rng';

// ---------------------------------------------------------------- constants

/** Version of these rules; shifts are played again by the rules they were played by. */
export const ORDER_RULES = 1;
export const ORDER_SHIFT_MS = 60_000;
/** Time the picker takes for one cell of the floor. */
export const ORDER_STEP_MS = 90;
/** The scanner shows the number this long, then it fades out over ORDER_SCAN_FADE_MS. */
export const ORDER_SCAN_MS = 2_000;
export const ORDER_SCAN_FADE_MS = 1_000;
export const ORDER_GOFRAS = 16;
/** Goods a gofra holds; a full gofra goes to its pre-sort. */
export const ORDER_CAP = 2;
/** Pickers in a room, the player included. */
export const ORDER_PLAYERS = 8;
export const ORDER_POINTS = {
  /** A good put into the right gofra. */
  item: 10,
  /** A full gofra taken to the right pre-sort. */
  gofra: 10,
  /** A good into a wrong gofra, or a gofra to a wrong pre-sort. */
  mistake: 10,
  /** At the end: every good not put away and every full gofra not taken away. */
  missed: 10,
} as const;

export const ORDER_COLS = 12;
export const ORDER_ROWS = 10;
/** The island of gofras: rows 4–5, columns 2–9. */
export const ORDER_ISLAND = { r: 4, c: 2, w: 8, h: 2 } as const;
/** The player's box of goods: row 7, columns 5–6. */
export const ORDER_BOX = { r: 7, c: 5, w: 2 } as const;
/** The 16 pre-sort places in a ring along the walls, clockwise from the top left. */
export const ORDER_SIGNS: readonly (readonly [number, number])[] = [
  [0, 2], [0, 4], [0, 7], [0, 9],
  [1, 11], [3, 11], [6, 11], [8, 11],
  [9, 9], [9, 7], [9, 4], [9, 2],
  [8, 0], [6, 0], [3, 0], [1, 0],
];
/** Where the other pickers' boxes stand (they are drawn only as the pickers). */
export const ORDER_HOMES: readonly (readonly [number, number])[] = [[1, 1], [1, 10], [8, 1], [8, 10], [2, 5], [2, 6], [8, 8]];

export const ORDER_PRESORTS = ['rostov', 'kazan', 'samara', 'perm', 'omsk', 'tula', 'ufa', 'sochi', 'orel', 'pskov', 'tomsk', 'kursk', 'tver', 'chita', 'kirov', 'penza'] as const;
export type OrderPresort = (typeof ORDER_PRESORTS)[number];

export const ORDER_GOODS = ['headphones', 'mug', 'books', 'sneakers', 'backpack', 'lamp', 'teddy', 'watch', 'phone', 'cream', 'plant', 'cap'] as const;
export type OrderGood = (typeof ORDER_GOODS)[number];
export const ORDER_GOOD_ICONS: Record<OrderGood, string> = {
  headphones: '🎧',
  mug: '☕',
  books: '📚',
  sneakers: '👟',
  backpack: '🎒',
  lamp: '💡',
  teddy: '🧸',
  watch: '⌚',
  phone: '📱',
  cream: '🧴',
  plant: '🪴',
  cap: '🧢',
};

/**
 * The computer pickers of a training shift, slots 1–7: `lag` is how long they
 * think before an action (ms, plus up to as much again), `slip` the chance of
 * a mistake in percent.
 */
export const ORDER_BOT_LEVELS: readonly { lag: number; slip: number }[] = [
  { lag: 250, slip: 4 },
  { lag: 450, slip: 8 },
  { lag: 800, slip: 18 },
  { lag: 350, slip: 10 },
  { lag: 600, slip: 6 },
  { lag: 950, slip: 25 },
  { lag: 700, slip: 14 },
];

// ------------------------------------------------------------- the floor

export const cellAt = (r: number, c: number) => r * ORDER_COLS + c;
export const rowCol = (k: number): [number, number] => [Math.floor(k / ORDER_COLS), k % ORDER_COLS];
/** The picker starts above the box. */
export const ORDER_START = cellAt(ORDER_BOX.r - 1, ORDER_BOX.c);

function blocked(r: number, c: number): boolean {
  const I = ORDER_ISLAND;
  if (r >= I.r && r < I.r + I.h && c >= I.c && c < I.c + I.w) return true;
  if (r === ORDER_BOX.r && c >= ORDER_BOX.c && c < ORDER_BOX.c + ORDER_BOX.w) return true;
  return ORDER_SIGNS.some(([sr, sc]) => sr === r && sc === c);
}
export const walkable = (r: number, c: number) => r >= 0 && r < ORDER_ROWS && c >= 0 && c < ORDER_COLS && !blocked(r, c);

/** Row and column of gofra n (1–16). */
export const gofraCell = (n: number): [number, number] =>
  n <= 8 ? [ORDER_ISLAND.r, ORDER_ISLAND.c + n - 1] : [ORDER_ISLAND.r + 1, ORDER_ISLAND.c + n - 9];
/** Where the picker stands to reach gofra n: in front of its row. */
export const gofraSpots = (n: number): number[] =>
  n <= 8 ? [cellAt(ORDER_ISLAND.r - 1, ORDER_ISLAND.c + n - 1)] : [cellAt(ORDER_ISLAND.r + ORDER_ISLAND.h, ORDER_ISLAND.c + n - 9)];
export function signSpots(pos: number): number[] {
  const [r, c] = ORDER_SIGNS[pos];
  if (r === 0) return [cellAt(1, c)];
  if (r === ORDER_ROWS - 1) return [cellAt(ORDER_ROWS - 2, c)];
  if (c === 0) return [cellAt(r, 1)];
  return [cellAt(r, ORDER_COLS - 2)];
}
const B = ORDER_BOX;
export const BOX_SPOTS: number[] = [cellAt(B.r - 1, B.c), cellAt(B.r - 1, B.c + 1), cellAt(B.r + 1, B.c), cellAt(B.r + 1, B.c + 1), cellAt(B.r, B.c - 1), cellAt(B.r, B.c + B.w)];

/** Cells from a to b, both included, the shortest way (always the same one); null if b cannot be reached. */
function route(a: number, b: number): number[] | null {
  const n = ORDER_ROWS * ORDER_COLS;
  const prev = new Array<number>(n).fill(-1);
  const seen = new Array<boolean>(n).fill(false);
  const q = [a];
  seen[a] = true;
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    const [r, c] = rowCol(k);
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (!walkable(nr, nc)) continue;
      const nk = cellAt(nr, nc);
      if (!seen[nk]) {
        seen[nk] = true;
        prev[nk] = k;
        q.push(nk);
      }
    }
  }
  if (!seen[b]) return null;
  const out = [b];
  let k = b;
  while (k !== a) {
    k = prev[k];
    out.push(k);
  }
  return out.reverse();
}

/** The shortest way from a cell to any of the spots; the first spot wins a tie. */
export function shortestPath(from: number, spots: number[]): number[] {
  let best: number[] | null = null;
  for (const s of spots) {
    const p = route(from, s);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best ?? [from];
}

// ------------------------------------------------------------- a shift

export interface OrderItem {
  id: number;
  /** Gofra the good goes to: the number the scanner shows. */
  gofra: number;
  good: number;
  /** Shift time (ms) the good comes into the box. */
  at: number;
}

export interface OrderShift {
  seed: number;
  /** The goods of every slot of the room, slot 0 first. */
  flows: OrderItem[][];
  /** Pre-sort of gofra n at index n − 1. */
  presorts: OrderPresort[];
  /** Pre-sorts in the order of the places along the walls (ORDER_SIGNS). */
  signs: OrderPresort[];
}

function shuffle<T>(items: readonly T[], s0: RngState): [T[], RngState] {
  const a = items.slice();
  let s = s0;
  for (let i = a.length - 1; i > 0; i--) {
    let j: number;
    [j, s] = nextInt(s, 0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return [a, s];
}

const repeats = (a: number[]) => a.some((x, i) => i > 0 && x === a[i - 1]);

/**
 * The goods of one picker: 8–10 of them. Three or four gofras get two goods
 * each and fill up; every other gofra gets at most one. The same gofra never
 * comes twice in a row. Three goods are in the box at the start, then one
 * comes every 2–3.5 seconds.
 */
function makeFlow(s0: RngState): [OrderItem[], RngState] {
  let s = s0;
  let count: number;
  let extra: number;
  [count, s] = nextInt(s, 8, 10);
  [extra, s] = nextInt(s, 0, 1);
  const busy = Math.min(3 + extra, Math.floor(count / ORDER_CAP));
  let order: number[];
  [order, s] = shuffle(Array.from({ length: ORDER_GOFRAS }, (_, i) => i + 1), s);
  const nums: number[] = [];
  for (const n of order.slice(0, busy)) for (let i = 0; i < ORDER_CAP; i++) nums.push(n);
  let others: number[];
  [others, s] = shuffle(order.slice(busy), s);
  for (const n of others) {
    if (nums.length >= count) break;
    nums.push(n);
  }
  let flow: number[] = nums;
  for (let tries = 0; tries < 200; tries++) {
    [flow, s] = shuffle(nums, s);
    if (!repeats(flow)) break;
  }
  // Still a repeat after many tries: move the second of a pair to a place where it fits.
  for (let i = 1; i < flow.length && repeats(flow); i++) {
    if (flow[i] !== flow[i - 1]) continue;
    const j = flow.findIndex((x, k) => k > i && x !== flow[i] && (k + 1 >= flow.length || flow[k + 1] !== flow[i]) && flow[k - 1] !== flow[i]);
    if (j > 0) [flow[i], flow[j]] = [flow[j], flow[i]];
  }
  const items: OrderItem[] = [];
  let at = 0;
  for (let id = 0; id < flow.length; id++) {
    let gap: number;
    let good: number;
    [gap, s] = nextInt(s, 0, 1500);
    [good, s] = nextInt(s, 0, ORDER_GOODS.length - 1);
    if (id >= 3) at += 2000 + gap;
    items.push({ id, gofra: flow[id], good, at });
  }
  return [items, s];
}

/** A shift of a room: everyone's goods, the pre-sort of every gofra and the order of the pre-sorts along the walls. */
export function makeShift(seed: number): OrderShift {
  let s: RngState = seed >>> 0;
  const flows: OrderItem[][] = [];
  for (let i = 0; i < ORDER_PLAYERS; i++) {
    let flow: OrderItem[];
    [flow, s] = makeFlow(s);
    flows.push(flow);
  }
  let presorts: OrderPresort[];
  let signs: OrderPresort[];
  [presorts, s] = shuffle(ORDER_PRESORTS, s);
  [signs, s] = shuffle(ORDER_PRESORTS, s);
  return { seed, flows, presorts, signs };
}

export const presortOf = (shift: OrderShift, n: number): OrderPresort => shift.presorts[n - 1];
/** Place along the walls of the pre-sort of gofra n. */
export const signOf = (shift: OrderShift, n: number): number => shift.signs.indexOf(presortOf(shift, n));

// ------------------------------------------------------------- playing

export type OrderHand = { kind: 'item'; id: number } | { kind: 'gofra'; n: number } | null;
export type OrderPlace = { kind: 'box' } | { kind: 'gofra'; n: number } | { kind: 'sign'; pos: number } | null;

/** One walk of the picker: from cells[0] at time `from`, one cell every ORDER_STEP_MS. */
export interface OrderWalk {
  from: number;
  cells: number[];
}

/** What happened in a shift, by the time it happened (ms). */
export type OrderEvent =
  | { t: number; kind: 'take' | 'scan'; item: number }
  | { t: number; kind: 'drop' | 'wrongGofra'; item: number; gofra: number }
  | { t: number; kind: 'lift'; gofra: number }
  | { t: number; kind: 'deliver' | 'wrongSign'; gofra: number; pos: number };

export interface OrderState {
  rules: number;
  seed: number;
  slot: number;
  items: OrderItem[];
  /** By item id: taken out of the box, and put into its gofra. */
  taken: boolean[];
  done: boolean[];
  /** Goods in gofra n at index n (index 0 unused). A lifted gofra keeps its count until it is delivered. */
  fill: number[];
  hand: OrderHand;
  pos: number;
  place: OrderPlace;
  /** Shift time the picker is free again. */
  time: number;
  correct: number;
  /** Gofras delivered to their pre-sorts, in order. */
  sent: number[];
  mistakes: number;
  walks: OrderWalk[];
  events: OrderEvent[];
  finished: boolean;
  /** Shift time the shift closed: the bell, the player leaving, or everything done. */
  finishedAt: number | null;
  /** Everything was done before the bell. */
  early: boolean;
}

export interface OrderScore {
  correct: number;
  sent: number;
  mistakes: number;
  /** Goods not put away and full gofras not delivered when the shift closed. */
  missed: number;
  /** Whole seconds left on the clock when everything was done early. */
  bonus: number;
  total: number;
}

export type OrderOutcome =
  | 'took'
  | 'scanned'
  | 'dropped'
  | 'filled'
  | 'wrongGofra'
  | 'lifted'
  | 'delivered'
  | 'wrongSign'
  | 'refused'
  | 'late';

export function createOrder(shift: OrderShift, slot: number): OrderState {
  const items = shift.flows[slot] ?? [];
  return {
    rules: ORDER_RULES,
    seed: shift.seed,
    slot,
    items,
    taken: items.map(() => false),
    done: items.map(() => false),
    fill: new Array<number>(ORDER_GOFRAS + 1).fill(0),
    hand: null,
    pos: ORDER_START,
    place: { kind: 'box' },
    time: 0,
    correct: 0,
    sent: [],
    mistakes: 0,
    walks: [],
    events: [],
    finished: false,
    finishedAt: null,
    early: false,
  };
}

/** Goods in the box at a moment of the shift. */
export const inBox = (st: OrderState, t: number): OrderItem[] => st.items.filter((it) => it.at <= t && !st.taken[it.id]);
/** Gofras that are full and still on the island (a lifted one is in the picker's hands). */
export const fullGofras = (st: OrderState): number[] => {
  const out: number[] = [];
  for (let n = 1; n <= ORDER_GOFRAS; n++) if (st.fill[n] >= ORDER_CAP && !(st.hand?.kind === 'gofra' && st.hand.n === n)) out.push(n);
  return out;
};

const allDone = (st: OrderState) => st.done.every(Boolean) && st.hand === null && st.fill.every((f) => f < ORDER_CAP);

function close(st: OrderState, at: number, early: boolean): OrderState {
  return { ...st, finished: true, finishedAt: Math.min(at, ORDER_SHIFT_MS), early };
}

/** Closes the shift at a moment (the bell, or the player leaving); a closed shift stays as it is. */
export function finishOrder(st: OrderState, at: number = ORDER_SHIFT_MS): OrderState {
  return st.finished ? st : close(st, Math.max(0, Math.min(at, ORDER_SHIFT_MS)), false);
}

/**
 * Plays one action of the player. The picker walks to the place first, so the
 * action takes effect when they get there: `state.time` is that moment. An
 * action given while the picker is still busy starts when they are free. An
 * action that makes no sense now changes nothing ('refused').
 */
export function applyOrder(st: OrderState, action: OrderAction, shift: OrderShift): { state: OrderState; outcome: OrderOutcome } {
  const refused = { state: st, outcome: 'refused' as const };
  if (st.finished) return refused;
  const start = Math.max(Math.floor(action.t), st.time);
  if (start >= ORDER_SHIFT_MS) return { state: close(st, ORDER_SHIFT_MS, false), outcome: 'late' };

  /** Walks to the spots; null if the bell rings on the way. */
  const walk = (spots: number[], s: OrderState): OrderState | null => {
    const cells = shortestPath(s.pos, spots);
    const arrive = start + (cells.length - 1) * ORDER_STEP_MS;
    const walks = cells.length > 1 ? [...s.walks, { from: start, cells }] : s.walks;
    if (arrive > ORDER_SHIFT_MS) return null;
    return { ...s, walks, pos: cells[cells.length - 1], time: arrive };
  };
  const late = (spots: number[]): { state: OrderState; outcome: OrderOutcome } => {
    const cells = shortestPath(st.pos, spots);
    return { state: close({ ...st, walks: [...st.walks, { from: start, cells }], place: null }, ORDER_SHIFT_MS, false), outcome: 'late' };
  };
  const settle = (s: OrderState, outcome: OrderOutcome) => ({ state: allDone(s) ? close(s, s.time, true) : s, outcome });

  switch (action.type) {
    case 'scan': {
      if (st.hand?.kind !== 'item') return refused;
      return { state: { ...st, events: [...st.events, { t: start, kind: 'scan', item: st.hand.id }] }, outcome: 'scanned' };
    }
    case 'take': {
      const it = st.items[action.item];
      if (st.hand || !it || st.taken[it.id] || it.at > start) return refused;
      const s = walk(BOX_SPOTS, st);
      if (!s) return late(BOX_SPOTS);
      const taken = st.taken.slice();
      taken[it.id] = true;
      return settle({ ...s, taken, hand: { kind: 'item', id: it.id }, place: { kind: 'box' }, events: [...s.events, { t: s.time, kind: 'take', item: it.id }] }, 'took');
    }
    case 'gofra': {
      const n = action.n;
      if (!Number.isInteger(n) || n < 1 || n > ORDER_GOFRAS) return refused;
      const h = st.hand;
      if (h?.kind === 'gofra') return refused;
      if (!h) {
        // Empty hands at a full gofra: lift it to take it to its pre-sort.
        if (st.fill[n] < ORDER_CAP) return refused;
        const s = walk(gofraSpots(n), st);
        if (!s) return late(gofraSpots(n));
        return settle({ ...s, hand: { kind: 'gofra', n }, place: { kind: 'gofra', n }, events: [...s.events, { t: s.time, kind: 'lift', gofra: n }] }, 'lifted');
      }
      const it = st.items[h.id];
      const s = walk(gofraSpots(n), st);
      if (!s) return late(gofraSpots(n));
      const here = { ...s, place: { kind: 'gofra', n } as OrderPlace };
      if (it.gofra !== n || st.fill[n] >= ORDER_CAP) {
        return settle({ ...here, mistakes: s.mistakes + 1, events: [...s.events, { t: s.time, kind: 'wrongGofra', item: it.id, gofra: n }] }, 'wrongGofra');
      }
      const fill = s.fill.slice();
      fill[n]++;
      const done = s.done.slice();
      done[it.id] = true;
      return settle(
        { ...here, fill, done, hand: null, correct: s.correct + 1, events: [...s.events, { t: s.time, kind: 'drop', item: it.id, gofra: n }] },
        fill[n] >= ORDER_CAP ? 'filled' : 'dropped',
      );
    }
    case 'sign': {
      const pos = action.pos;
      const h = st.hand;
      if (h?.kind !== 'gofra' || !Number.isInteger(pos) || pos < 0 || pos >= ORDER_SIGNS.length) return refused;
      const s = walk(signSpots(pos), st);
      if (!s) return late(signSpots(pos));
      const here = { ...s, place: { kind: 'sign', pos } as OrderPlace };
      if (shift.signs[pos] !== presortOf(shift, h.n)) {
        return settle({ ...here, mistakes: s.mistakes + 1, events: [...s.events, { t: s.time, kind: 'wrongSign', gofra: h.n, pos }] }, 'wrongSign');
      }
      // Delivered: an empty gofra with the same number takes the old one's place.
      const fill = s.fill.slice();
      fill[h.n] = 0;
      return settle({ ...here, fill, hand: null, sent: [...s.sent, h.n], events: [...s.events, { t: s.time, kind: 'deliver', gofra: h.n, pos }] }, 'delivered');
    }
  }
  return refused;
}

/** The score of a closed shift (or of a shift so far, without the end penalties). */
export function orderScore(st: OrderState): OrderScore {
  const P = ORDER_POINTS;
  const missed = st.finished ? st.done.filter((d) => !d).length + st.fill.filter((f) => f >= ORDER_CAP).length : 0;
  const bonus = st.finished && st.early && st.finishedAt !== null ? Math.floor((ORDER_SHIFT_MS - st.finishedAt) / 1000) : 0;
  const total = st.correct * P.item + st.sent.length * P.gofra - st.mistakes * P.mistake - missed * P.missed + bonus;
  return { correct: st.correct, sent: st.sent.length, mistakes: st.mistakes, missed, bonus, total };
}

/** Points of a shift up to a moment, as they were seen during it. */
export function pointsAt(st: OrderState, t: number): number {
  const P = ORDER_POINTS;
  let p = 0;
  for (const e of st.events) {
    if (e.t > t) break;
    if (e.kind === 'drop') p += P.item;
    else if (e.kind === 'deliver') p += P.gofra;
    else if (e.kind === 'wrongGofra' || e.kind === 'wrongSign') p -= P.mistake;
  }
  return p;
}

/** Actions a server accepts: whole-number times within the shift, in order, at most 500 of them. */
export function cleanOrderActions(raw: unknown): OrderAction[] | null {
  if (!Array.isArray(raw) || raw.length > 500) return null;
  const out: OrderAction[] = [];
  let last = 0;
  for (const a of raw) {
    if (!a || typeof a !== 'object') return null;
    const x = a as Record<string, unknown>;
    const t = x.t;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < last || t > ORDER_SHIFT_MS) return null;
    last = t;
    const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
    if (x.type === 'take' && int(x.item)) out.push({ t, type: 'take', item: x.item as number });
    else if (x.type === 'gofra' && int(x.n)) out.push({ t, type: 'gofra', n: x.n as number });
    else if (x.type === 'sign' && int(x.pos)) out.push({ t, type: 'sign', pos: x.pos as number });
    else if (x.type === 'scan') out.push({ t, type: 'scan' });
    else return null;
  }
  return out;
}

/** Plays a shift again from its seed and the actions; it closes at `endAt` unless it was done earlier. */
export function replayOrder(shift: OrderShift, slot: number, actions: OrderAction[], endAt: number = ORDER_SHIFT_MS): OrderState {
  let st = createOrder(shift, slot);
  for (const a of actions) {
    if (st.finished || a.t > endAt) break;
    st = applyOrder(st, a, shift).state;
  }
  return finishOrder(st, Math.max(endAt, st.time));
}

// ------------------------------------------------------------- the computer

/**
 * A computer picker of a training shift: it takes the goods as they come,
 * carries full gofras away first, sometimes goes to a wrong gofra or pre-sort.
 * Its whole shift follows from the seed and its slot.
 */
export function playBot(shift: OrderShift, slot: number): { state: OrderState; actions: OrderAction[] } {
  const level = ORDER_BOT_LEVELS[(slot - 1 + ORDER_BOT_LEVELS.length) % ORDER_BOT_LEVELS.length];
  let s: RngState = (shift.seed ^ Math.imul(slot + 1, 0x9e3779b9)) >>> 0;
  let st = createOrder(shift, slot);
  const actions: OrderAction[] = [];
  const slipped = new Set<string>();
  const roll = (key: string, percent: number): boolean => {
    if (slipped.has(key)) return false;
    let r: number;
    [r, s] = nextInt(s, 0, 99);
    if (r < percent) {
      slipped.add(key);
      return true;
    }
    return false;
  };
  let t = 0;
  for (let guard = 0; guard < 400 && !st.finished; guard++) {
    let think: number;
    [think, s] = nextInt(s, 0, level.lag);
    t = Math.max(t, st.time) + level.lag + think;
    if (t >= ORDER_SHIFT_MS) break;
    let action: OrderAction | null = null;
    const h = st.hand;
    if (h?.kind === 'item') {
      const right = st.items[h.id].gofra;
      const wrong = (right % ORDER_GOFRAS) + 1;
      action = { t, type: 'gofra', n: roll(`i${h.id}`, level.slip) && st.fill[wrong] < ORDER_CAP ? wrong : right };
    } else if (h?.kind === 'gofra') {
      const right = signOf(shift, h.n);
      action = { t, type: 'sign', pos: roll(`g${h.n}:${st.sent.length}`, Math.floor(level.slip / 2)) ? (right + 1) % ORDER_SIGNS.length : right };
    } else {
      const full = fullGofras(st);
      const box = inBox(st, t);
      if (full.length) action = { t, type: 'gofra', n: full[0] };
      else if (box.length) action = { t, type: 'take', item: box[0].id };
      else {
        const next = st.items.filter((it) => !st.taken[it.id]).map((it) => it.at);
        if (!next.length) break;
        t = Math.max(t, Math.min(...next));
        continue;
      }
    }
    const res = applyOrder(st, action, shift);
    if (res.outcome === 'refused') continue;
    actions.push(action);
    st = res.state;
  }
  return { state: finishOrder(st), actions };
}

// ------------------------------------------------------------- drawing

/** Where the picker is at a moment of the shift, in cells (fractions while walking). */
export function pickerAt(walks: OrderWalk[], t: number): { r: number; c: number } {
  let pos = ORDER_START;
  for (const w of walks) {
    if (t < w.from) break;
    const steps = w.cells.length - 1;
    const done = (t - w.from) / ORDER_STEP_MS;
    if (done >= steps) {
      pos = w.cells[steps];
      continue;
    }
    const i = Math.floor(done);
    const [r0, c0] = rowCol(w.cells[i]);
    const [r1, c1] = rowCol(w.cells[i + 1]);
    const f = done - i;
    return { r: r0 + (r1 - r0) * f, c: c0 + (c1 - c0) * f };
  }
  const [r, c] = rowCol(pos);
  return { r, c };
}

/** What a picker holds at a moment, from the events of their shift. */
export function holdingAt(st: OrderState, t: number): 'item' | 'gofra' | null {
  let h: 'item' | 'gofra' | null = null;
  for (const e of st.events) {
    if (e.t > t) break;
    if (e.kind === 'take') h = 'item';
    else if (e.kind === 'drop' || e.kind === 'deliver') h = null;
    else if (e.kind === 'lift') h = 'gofra';
  }
  return h;
}
