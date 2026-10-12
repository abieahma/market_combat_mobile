// Chart Duel: the first Market Combat game.
//
// Pure, deterministic rules with no React or platform imports, so the same
// file can run on the game server later. Everyone trades one shared price
// series with the same starting balance (the player's stake in Chart Duel
// dollars); the highest balance after the timer wins.

import { nextFloat, nextInt, nextNormal, nextRange, pick, RngState } from './rng';

// ---------------------------------------------------------------- constants

export const TICK_MS = 250;
export const MATCH_SECONDS = 60;
export const MATCH_TICKS = (MATCH_SECONDS * 1000) / TICK_MS;
/** Ticks of price history shown before the match starts. */
export const HISTORY_TICKS = 80;
/** Starting balance when no stake is given (previews, tests). */
export const START_CASH = 10_000;
export const START_PRICE = 100;
/** Trading fee, share of position size, charged on open and on close. */
export const FEE_RATE = 0.0004;
/** A position is liquidated when its loss reaches this share of its margin. */
export const LIQUIDATION_LOSS = 0.95;
export const LEVERAGES = [1, 2, 5, 10] as const;
/** Ticks between a headline appearing and the price starting to move. */
export const NEWS_LEAD_TICKS = 2;

export type Leverage = (typeof LEVERAGES)[number];
export type Side = 1 | -1;
export type BotStyle = 'momentum' | 'contrarian' | 'newshound';

export const BULLISH_NEWS = ['whaleBuy', 'etfRumor', 'partnership'] as const;
export const BEARISH_NEWS = ['exchangeHack', 'regulator', 'whaleSell'] as const;
export type NewsKind = (typeof BULLISH_NEWS)[number] | (typeof BEARISH_NEWS)[number];

// -------------------------------------------------------------------- types

export interface Position {
  side: Side;
  entry: number;
  leverage: Leverage;
  margin: number;
  /** Position size in cash terms at entry (margin × leverage). */
  size: number;
}

export interface Trader {
  id: string;
  name: string;
  isBot: boolean;
  style?: BotStyle;
  cash: number;
  position: Position | null;
  trades: number;
  liquidations: number;
  /** Bot only: tick of the next decision. */
  nextDecision: number;
  /** Bot only: tick the current position was opened. */
  openedAt: number;
}

export interface NewsEvent {
  kind: NewsKind;
  /** Tick (match time) the headline appears. */
  tick: number;
  direction: Side;
}

export interface DuelState {
  seed: number;
  /** Balance every trader starts with. */
  startCash: number;
  /** Match tick, 0 … MATCH_TICKS. */
  tick: number;
  /** HISTORY_TICKS + MATCH_TICKS + 1 prices; index HISTORY_TICKS is the match start. */
  prices: number[];
  news: NewsEvent[];
  traders: Trader[];
  botRng: RngState;
  finished: boolean;
  /** Short-lived events for the UI (cleared by the caller after reading). */
  events: DuelEvent[];
}

export type DuelEvent =
  | { type: 'news'; news: NewsEvent }
  | { type: 'liquidated'; traderId: string }
  | { type: 'finished' };

export type DuelAction = { type: 'open'; side: Side; leverage: Leverage } | { type: 'close' };

export interface PlayerSlot {
  id: string;
  name: string;
  isBot: boolean;
  style?: BotStyle;
}

export interface Standing {
  trader: Trader;
  equity: number;
  /** Change since start, e.g. 0.12 = +12 %. */
  change: number;
  place: number;
}

// ------------------------------------------------------------ price series

interface Series {
  prices: number[];
  news: NewsEvent[];
}

/** Per-tick volatility: calm, normal, stormy. */
const VOL_REGIMES = [0.0005, 0.0008, 0.0013];

function scheduleNews(rng: RngState): [NewsEvent[], RngState] {
  let s = rng;
  let count: number;
  [count, s] = nextInt(s, 2, 3);
  const news: NewsEvent[] = [];
  const minGap = 50;
  let attempts = 0;
  while (news.length < count && attempts < 50) {
    attempts++;
    let tick: number;
    [tick, s] = nextInt(s, 24, MATCH_TICKS - 24);
    if (news.some((n) => Math.abs(n.tick - tick) < minGap)) continue;
    let bullish: number;
    [bullish, s] = nextFloat(s);
    let kind: NewsKind;
    if (bullish < 0.5) [kind, s] = pick(s, BULLISH_NEWS);
    else [kind, s] = pick(s, BEARISH_NEWS);
    news.push({ kind, tick, direction: bullish < 0.5 ? 1 : -1 });
  }
  news.sort((a, b) => a.tick - b.tick);
  return [news, s];
}

export function generateSeries(seed: number): Series {
  let s: RngState = seed;
  let news: NewsEvent[];
  [news, s] = scheduleNews(s);

  // Per-tick extra return from news: the move starts NEWS_LEAD_TICKS after
  // the headline and is spread over several ticks, so quick players can react.
  const total = HISTORY_TICKS + MATCH_TICKS + 1;
  const shock = new Array<number>(total).fill(0);
  for (const n of news) {
    let magnitude: number;
    let duration: number;
    let fakeout: number;
    [magnitude, s] = nextRange(s, 0.01, 0.025);
    [duration, s] = nextInt(s, 6, 10);
    // One headline in five is a "sell the news" fakeout: the price goes the other way.
    [fakeout, s] = nextFloat(s);
    const direction = fakeout < 0.2 ? -n.direction : n.direction;
    if (fakeout < 0.2) magnitude *= 0.6;
    const start = HISTORY_TICKS + n.tick + NEWS_LEAD_TICKS;
    const perTick = Math.log(1 + magnitude) / duration;
    for (let i = 0; i < duration && start + i < total; i++) shock[start + i] += direction * perTick;
  }

  const prices: number[] = [START_PRICE];
  let regime = 1;
  let trend = 0;
  for (let i = 1; i < total; i++) {
    let r: number;
    [r, s] = nextFloat(s);
    if (r < 0.02) [regime, s] = nextInt(s, 0, VOL_REGIMES.length - 1);
    let z: number;
    [z, s] = nextNormal(s);
    let zt: number;
    [zt, s] = nextNormal(s);
    trend = trend * 0.97 + zt * 0.000015;
    const logReturn = trend + VOL_REGIMES[regime] * z + shock[i];
    prices.push(prices[i - 1] * Math.exp(logReturn));
  }

  // Rebase so the match starts exactly at START_PRICE.
  const base = prices[HISTORY_TICKS];
  return { prices: prices.map((p) => (p / base) * START_PRICE), news };
}

// ------------------------------------------------------------------- match

export function createDuel(seed: number, slots: PlayerSlot[], startCash: number = START_CASH): DuelState {
  const { prices, news } = generateSeries(seed);
  let botRng: RngState = (seed ^ 0x9e3779b9) >>> 0;
  const traders = slots.map((slot) => {
    let first = 0;
    if (slot.isBot) [first, botRng] = nextInt(botRng, 2, 10);
    const trader: Trader = {
      id: slot.id,
      name: slot.name,
      isBot: slot.isBot,
      style: slot.style,
      cash: startCash,
      position: null,
      trades: 0,
      liquidations: 0,
      nextDecision: first,
      openedAt: 0,
    };
    return trader;
  });
  return { seed, startCash, tick: 0, prices, news, traders, botRng, finished: false, events: [] };
}

export function priceAt(state: DuelState, tick = state.tick): number {
  return state.prices[HISTORY_TICKS + tick];
}

/** Prices visible to players right now: history plus the match so far. */
export function visiblePrices(state: DuelState): number[] {
  return state.prices.slice(0, HISTORY_TICKS + state.tick + 1);
}

export function unrealizedPnl(position: Position, price: number): number {
  return position.size * position.side * (price / position.entry - 1);
}

export function equityOf(trader: Trader, price: number): number {
  return trader.position ? trader.cash + unrealizedPnl(trader.position, price) : trader.cash;
}

export function secondsLeft(state: DuelState): number {
  return Math.max(0, Math.ceil(((MATCH_TICKS - state.tick) * TICK_MS) / 1000));
}

/** The headline currently on screen, if any (shown for 5 seconds). */
export function activeNews(state: DuelState): NewsEvent | null {
  const showTicks = 5000 / TICK_MS;
  for (const n of state.news) {
    if (state.tick >= n.tick && state.tick < n.tick + showTicks) return n;
  }
  return null;
}

export function standings(state: DuelState): Standing[] {
  const price = priceAt(state);
  return state.traders
    .map((trader) => {
      const equity = equityOf(trader, price);
      return { trader, equity, change: equity / state.startCash - 1, place: 0 };
    })
    .sort((a, b) => b.equity - a.equity)
    .map((s, i) => ({ ...s, place: i + 1 }));
}

// ----------------------------------------------------------------- trading

function openPosition(trader: Trader, side: Side, leverage: Leverage, price: number, tick: number): Trader {
  if (trader.position || trader.cash <= 1) return trader;
  const size = trader.cash * leverage;
  const fee = size * FEE_RATE;
  const cash = trader.cash - fee;
  return {
    ...trader,
    cash,
    position: { side, entry: price, leverage, margin: cash, size: cash * leverage },
    trades: trader.trades + 1,
    openedAt: tick,
  };
}

function closePosition(trader: Trader, price: number): Trader {
  if (!trader.position) return trader;
  const pnl = unrealizedPnl(trader.position, price);
  const exitSize = trader.position.size * (price / trader.position.entry);
  const fee = Math.abs(exitSize) * FEE_RATE;
  return { ...trader, cash: Math.max(0, trader.cash + pnl - fee), position: null };
}

export function applyAction(state: DuelState, traderId: string, action: DuelAction): DuelState {
  if (state.finished) return state;
  const price = priceAt(state);
  const traders = state.traders.map((t) => {
    if (t.id !== traderId) return t;
    return action.type === 'open' ? openPosition(t, action.side, action.leverage, price, state.tick) : closePosition(t, price);
  });
  return { ...state, traders };
}

// -------------------------------------------------------------------- bots

function botDecide(state: DuelState, trader: Trader, rng: RngState): [DuelAction | null, number, RngState] {
  let s = rng;
  const prices = visiblePrices(state);
  const last = prices[prices.length - 1];
  const back = (n: number) => prices[Math.max(0, prices.length - 1 - n)];
  const move12 = last / back(12) - 1;
  const move24 = last / back(24) - 1;
  let wait: number;
  [wait, s] = nextInt(s, 4, 9);

  const news = activeNews(state);
  const pos = trader.position;

  if (pos) {
    const pnlShare = unrealizedPnl(pos, last) / pos.margin;
    const held = state.tick - trader.openedAt;
    let roll: number;
    [roll, s] = nextFloat(s);
    const takeProfit = pnlShare > 0.12 + roll * 0.2;
    const stopLoss = pnlShare < -(0.1 + roll * 0.15);
    const stale = held > 40 + roll * 40;
    const against = news !== null && news.direction !== pos.side;
    if (takeProfit || stopLoss || stale || against) return [{ type: 'close' }, wait, s];
    return [null, wait, s];
  }

  let leverage: Leverage;
  let roll: number;
  [roll, s] = nextFloat(s);
  switch (trader.style) {
    case 'newshound': {
      if (news && state.tick - news.tick <= 6) {
        [leverage, s] = pick(s, [5, 10] as const);
        return [{ type: 'open', side: news.direction, leverage }, wait, s];
      }
      if (roll < 0.25) {
        [leverage, s] = pick(s, [1, 2] as const);
        return [{ type: 'open', side: move12 >= 0 ? 1 : -1, leverage }, wait, s];
      }
      return [null, wait, s];
    }
    case 'contrarian': {
      if (Math.abs(move24) > 0.006 && roll < 0.7) {
        [leverage, s] = pick(s, [2, 5] as const);
        return [{ type: 'open', side: move24 > 0 ? -1 : 1, leverage }, wait, s];
      }
      return [null, wait, s];
    }
    case 'momentum':
    default: {
      if (Math.abs(move12) > 0.003 && roll < 0.75) {
        [leverage, s] = pick(s, [2, 5, 10] as const);
        return [{ type: 'open', side: move12 > 0 ? 1 : -1, leverage }, wait, s];
      }
      return [null, wait, s];
    }
  }
}

// -------------------------------------------------------------------- tick

/** Advances the match by one tick: moves the price, runs bots, liquidations. */
export function stepDuel(state: DuelState): DuelState {
  if (state.finished) return state;
  const tick = state.tick + 1;
  const events: DuelEvent[] = [];
  let next: DuelState = { ...state, tick, events };
  const price = priceAt(next);

  for (const n of next.news) if (n.tick === tick) events.push({ type: 'news', news: n });

  // Liquidations.
  next = {
    ...next,
    traders: next.traders.map((t) => {
      if (!t.position) return t;
      if (unrealizedPnl(t.position, price) <= -LIQUIDATION_LOSS * t.position.margin) {
        events.push({ type: 'liquidated', traderId: t.id });
        const closed = closePosition(t, price);
        return { ...closed, liquidations: t.liquidations + 1 };
      }
      return t;
    }),
  };

  // Bots.
  let botRng = next.botRng;
  for (const bot of next.traders) {
    if (!bot.isBot || tick < bot.nextDecision || tick >= MATCH_TICKS) continue;
    let action: DuelAction | null;
    let wait: number;
    [action, wait, botRng] = botDecide(next, bot, botRng);
    if (action) next = applyAction(next, bot.id, action);
    next = {
      ...next,
      traders: next.traders.map((t) => (t.id === bot.id ? { ...t, nextDecision: tick + wait } : t)),
    };
  }
  next = { ...next, botRng };

  // Final bell: everything is closed at the last price.
  if (tick >= MATCH_TICKS) {
    next = { ...next, finished: true, traders: next.traders.map((t) => closePosition(t, price)) };
    events.push({ type: 'finished' });
  }
  return next;
}
