// Order Picking on the server stub: shifts, rooms of up to eight pickers,
// stakes in boxes and settling the rooms. The server never trusts a score
// from the app: it plays the shift again from the seed and the actions
// (src/game/order.ts) and counts it itself.
//
// Everyone in a room gets the same seed and plays the goods of their own
// slot, each at their own time. A room closes when all eight have played,
// or when its time is up; then the best score takes the bank.

import { CHARACTER_IDS, PLATFORM_ACCOUNT, PLATFORM_FEE_PERCENT } from '../api/contract';
import type {
  CharacterId,
  GameEntry,
  HistoryItem,
  OrderAction,
  OrderMode,
  OrderRival,
  OrderScoreView,
  OrderSettlement,
  OrderView,
  WalletTx,
} from '../api/contract';
import {
  cleanOrderActions,
  makeShift,
  ORDER_PLAYERS,
  ORDER_RULES,
  ORDER_SHIFT_MS,
  orderScore,
  playBot,
  replayOrder,
} from '../game/order';
import { WELCOME_BONUS } from '../wallet/ledger';
import { fail, randomId } from './errors';
import type { MockServer } from './server';

/** A room takes new players for this long; then it closes with whoever played. */
export const ORDER_ROOM_MS = 15 * 60 * 1000;
/** A shift not finished this long after its bell is closed by the server as it stands. */
export const ORDER_GRACE_MS = 30 * 1000;
/** Slack for the clocks of the app and the server when the actions come in. */
const CLOCK_SLACK_MS = 5000;
/** Names of the computer pickers of a training shift, slots 1–7. */
const BOT_NAMES = ['Nika', 'Den', 'Olya', 'Artyom', 'Liza', 'Max', 'Sasha'];
const TEST_PREFIX = 'acc_sparring_order_';

interface ShiftRow {
  id: string;
  accountId: string;
  nickname: string;
  character: CharacterId | null;
  mode: OrderMode;
  roomId: string | null;
  seed: number;
  slot: number;
  rules: number;
  requestId: string;
  startedAt: number;
  stakeLots: number;
  stake: number;
  startTx: WalletTx | null;
  /** The actions, the moment the player finished and the score the server counted. */
  finished: { actions: OrderAction[]; endAt: number; score: OrderScoreView } | null;
  finishedAt: number | null;
  /** Closed by the server: never finished, or left for a new shift. */
  abandoned: boolean;
  /** A test player of the developer panel. */
  test: boolean;
  settlement: OrderSettlement | null;
}

interface RoomRow {
  id: string;
  seed: number;
  stakeLots: number;
  stake: number;
  createdAt: number;
  closesAt: number;
  /** Shift ids by slot. */
  slots: string[];
  settledAt: number | null;
}

/** What the history needs from the shifts. */
export interface OrderHistory {
  items(accountId: string): HistoryItem[];
  view(accountId: string, id: string): OrderView | null;
}

const better = (a: OrderScoreView, b: OrderScoreView) => b.total - a.total || a.mistakes - b.mistakes;

/** Places of scores: equal total and mistakes share a place. */
function places(scores: OrderScoreView[]): number[] {
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => better(a.s, b.s));
  const out = new Array<number>(scores.length).fill(0);
  order.forEach((x, k) => {
    const prev = order[k - 1];
    out[x.i] = prev && better(prev.s, x.s) === 0 ? out[prev.i] : k + 1;
  });
  return out;
}

export function registerOrderRoutes(s: MockServer): OrderHistory {
  const shifts = () => s.db.table<ShiftRow>('orderShifts');
  const rooms = () => s.db.table<RoomRow>('orderRooms');
  const game = (): GameEntry => s.game('order');

  /** Stakes `lots` of boxes for a player: buys what is missing, then moves the boxes into the shift. */
  const stakeIn = (accountId: string, shiftId: string, lots: number, key: string): WalletTx | null => {
    const g = game();
    const { units } = g.currency!.rate;
    const stake = lots * units;
    const missing = stake - s.currencyLedger(accountId, g.id).balance;
    const tx = missing > 0 ? s.buyCurrency(accountId, g, Math.ceil(missing / units), key) : null;
    s.currencyPost(accountId, g.id, { id: `stake:${shiftId}`, kind: 'stake', amount: -stake, ref: shiftId });
    return tx;
  };

  /** Gives `back` boxes of a shift back as ABIE at the game rate. */
  const payBack = (row: ShiftRow, back: number): { payout: number; tx: WalletTx | null } => {
    const g = game();
    const { abie, units } = g.currency!.rate;
    if (back <= 0) return { payout: 0, tx: null };
    s.currencyPost(row.accountId, g.id, { id: `settle:${row.id}`, kind: 'settle', amount: back, ref: row.id });
    s.currencyPost(row.accountId, g.id, { id: `convert:${row.id}`, kind: 'convert', amount: -back, ref: row.id });
    const payout = Math.round((back * abie) / units);
    if (payout <= 0) return { payout: 0, tx: null };
    const now = s.now();
    const tx = s.wallet.post(row.accountId, { id: `return:${row.id}`, kind: 'currency_return', amount: payout, ref: row.id }, now);
    s.wallet.post(PLATFORM_ACCOUNT, { id: `payout:${row.id}`, kind: 'currency_payout', amount: -payout, ref: row.accountId }, now);
    return { payout, tx };
  };

  /** Plays a shift again and keeps what the server counted. */
  const finish = (row: ShiftRow, actions: OrderAction[], endAt: number, abandoned: boolean): ShiftRow => {
    const st = replayOrder(makeShift(row.seed), row.slot, actions, endAt);
    const score = orderScore(st);
    const next: ShiftRow = { ...row, finished: { actions, endAt: st.finishedAt ?? endAt, score }, finishedAt: s.now(), abandoned };
    shifts().put(row.id, next);
    return next;
  };

  /** A shift never finished long after its bell is closed as it stands: no goods put away. */
  const closeStale = (row: ShiftRow): ShiftRow =>
    !row.finished && s.now() > row.startedAt + ORDER_SHIFT_MS + ORDER_GRACE_MS ? finish(row, [], ORDER_SHIFT_MS, true) : row;

  /**
   * Settles a room once everyone in it has played, or when its time is up:
   * the best score takes the stakes of the others, the platform keeps
   * PLATFORM_FEE_PERCENT of them. Alone in the room, or all tied: stakes back.
   */
  const settleRoom = (room: RoomRow) => {
    if (room.settledAt !== null) return;
    let rows = room.slots.map((id) => shifts().get(id)!).filter(Boolean);
    const full = rows.length >= ORDER_PLAYERS;
    const timeUp = s.now() >= room.closesAt;
    if (!timeUp && !(full && rows.every((r) => r.finished))) return;
    // The room closes: shifts still open are closed as they stand.
    rows = rows.map((r) => (r.finished ? r : finish(r, [], ORDER_SHIFT_MS, true)));
    const scores = rows.map((r) => r.finished!.score);
    const place = places(scores);
    const n = rows.length;
    const winners = place.filter((p) => p === 1).length;
    const refunded = n <= 1 || winners === n;
    const { abie } = game().currency!.rate;
    const fee = refunded ? 0 : ((n - winners) * room.stake * PLATFORM_FEE_PERCENT) / 100;
    const winnerBack = room.stake + Math.floor(((n - winners) * room.stake - fee) / winners);
    rows.forEach((r, i) => {
      const won = place[i] === 1;
      const back = refunded ? room.stake : won ? winnerBack : 0;
      const { payout, tx } = payBack(r, back);
      const net = payout - room.stakeLots * abie;
      const settlement: OrderSettlement = {
        place: place[i],
        players: n,
        winners,
        stake: room.stake,
        back,
        fee: won && !refunded ? Math.floor(fee / winners) : 0,
        payout,
        net,
        refunded,
        tx,
      };
      shifts().put(r.id, { ...r, settlement });
      if (!r.test) {
        const p = s.profile(r.accountId);
        s.saveProfile({ ...p, stats: { matches: p.stats.matches + 1, wins: p.stats.wins + (won ? 1 : 0), earned: p.stats.earned + net } });
      }
    });
    rooms().put(room.id, { ...room, settledAt: s.now() });
  };

  /** Brings a shift and its room up to the present. */
  const advance = (row: ShiftRow): ShiftRow => {
    let r = closeStale(row);
    if (r.roomId) {
      const room = rooms().get(r.roomId);
      if (room) {
        for (const id of room.slots) {
          const other = shifts().get(id);
          if (other) closeStale(other);
        }
        settleRoom(room);
        r = shifts().get(r.id)!;
      }
    }
    return r;
  };

  /** Test players of the developer panel fill the room: they stake like anyone and play at once. */
  const addTestPlayers = (room: RoomRow): RoomRow => {
    const g = game();
    const shift = makeShift(room.seed);
    const slots = [...room.slots];
    const now = s.now();
    for (let slot = slots.length; slot < ORDER_PLAYERS; slot++) {
      const accountId = `${TEST_PREFIX}${slot}`;
      const cost = room.stakeLots * g.currency!.rate.abie;
      if (s.wallet.balance(accountId) < cost) s.wallet.post(accountId, { id: `order-test-topup:${room.id}:${slot}`, kind: 'welcome', amount: Math.max(WELCOME_BONUS, cost) }, now);
      const id = randomId('shift');
      const startTx = stakeIn(accountId, id, room.stakeLots, `order:${room.id}:${slot}`);
      const bot = playBot(shift, slot);
      const score = orderScore(bot.state);
      shifts().put(id, {
        id,
        accountId,
        nickname: `Test ${slot}`,
        character: CHARACTER_IDS[slot % CHARACTER_IDS.length],
        mode: 'stake',
        roomId: room.id,
        seed: room.seed,
        slot,
        rules: ORDER_RULES,
        requestId: id,
        startedAt: now,
        stakeLots: room.stakeLots,
        stake: room.stake,
        startTx,
        finished: { actions: bot.actions, endAt: bot.state.finishedAt ?? ORDER_SHIFT_MS, score },
        finishedAt: now,
        abandoned: false,
        test: true,
        settlement: null,
      });
      slots.push(id);
    }
    return rooms().put(room.id, { ...room, slots });
  };

  const view = (row0: ShiftRow): OrderView => {
    const row = advance(row0);
    const shift = makeShift(row.seed);
    let rivals: OrderRival[] = [];
    let place: number | null = null;
    if (row.mode === 'training') {
      // The computer pickers' shifts follow from the seed; their scores show once the player is done.
      const bots = Array.from({ length: ORDER_PLAYERS - 1 }, (_, i) => i + 1).map((slot) => ({ slot, bot: playBot(shift, slot) }));
      rivals = bots.map(({ slot, bot }) => ({
        slot,
        nickname: BOT_NAMES[slot - 1],
        character: CHARACTER_IDS[slot % CHARACTER_IDS.length],
        isBot: true,
        finished: !!row.finished,
        score: row.finished ? orderScore(bot.state) : null,
        actions: null,
        endAt: null,
      }));
      if (row.finished) place = places([row.finished.score, ...bots.map((b) => orderScore(b.bot.state))])[0];
    } else if (row.roomId) {
      const room = rooms().get(row.roomId);
      const others = (room?.slots ?? []).filter((id) => id !== row.id).map((id) => shifts().get(id)!).filter(Boolean);
      rivals = others.map((o) => ({
        slot: o.slot,
        nickname: o.nickname,
        character: o.character,
        isBot: false,
        finished: !!o.finished,
        score: o.finished?.score ?? null,
        actions: o.finished?.actions ?? null,
        endAt: o.finished?.endAt ?? null,
      }));
      if (row.settlement) place = row.settlement.place;
      else if (row.finished) {
        const done = [row, ...others.filter((o) => o.finished)];
        place = places(done.map((o) => o.finished!.score))[0];
      }
    }
    const room = row.roomId ? rooms().get(row.roomId) : undefined;
    return {
      id: row.id,
      mode: row.mode,
      status: row.abandoned ? 'abandoned' : !row.finished ? 'playing' : row.mode === 'stake' && !row.settlement ? 'waiting' : 'settled',
      rules: row.rules,
      seed: row.seed,
      slot: row.slot,
      startedAt: row.startedAt,
      serverNow: s.now(),
      closesAt: room ? room.closesAt : null,
      stake: row.stake,
      stakeLots: row.stakeLots,
      tx: row.startTx,
      actions: row.finished?.actions ?? null,
      endAt: row.finished?.endAt ?? null,
      score: row.finished?.score ?? null,
      place,
      rivals,
      settlement: row.settlement,
    };
  };

  const mine = (accountId: string, id: string): ShiftRow => {
    const row = shifts().get(id);
    if (!row || row.accountId !== accountId) return fail(404, 'not_found', 'Unknown shift');
    return row;
  };

  s.route('POST', '/v1/order/shifts', ({ req }): OrderView => {
    const accountId = s.accountIdFor(req);
    const g = game();
    const p = s.playable(accountId, g);
    const body = (req.body ?? {}) as { mode?: unknown; stakeLots?: unknown; requestId?: unknown };
    if (body.mode !== 'training' && body.mode !== 'stake') return fail(400, 'invalid_input', 'mode must be training or stake');
    if (typeof body.requestId !== 'string' || !body.requestId) return fail(400, 'invalid_input', 'requestId is required');
    const requestId = body.requestId;
    const mode = body.mode;

    // The same request again (the first answer was lost): the same shift.
    const again = shifts()
      .values()
      .find((r) => r.accountId === accountId && r.requestId === requestId);
    if (again) return view(again);
    // A shift of this player still open is closed as it stands: one shift at a time.
    for (const r of shifts().values()) if (r.accountId === accountId && !r.finished) finish(r, [], 0, true);

    const now = s.now();
    const base = {
      accountId,
      nickname: p.nickname,
      character: p.character,
      rules: ORDER_RULES,
      requestId,
      startedAt: now,
      finished: null,
      finishedAt: null,
      abandoned: false,
      test: false,
      settlement: null,
    };

    if (mode === 'training') {
      // Training: no stake, nothing to win.
      const id = randomId('shift');
      const row: ShiftRow = { ...base, id, mode, roomId: null, seed: Math.floor(Math.random() * 0xffffffff) >>> 0, slot: 0, stakeLots: 0, stake: 0, startTx: null };
      shifts().put(id, row);
      return view(row);
    }

    const lots = body.stakeLots;
    if (typeof lots !== 'number' || !Number.isInteger(lots) || lots < 1 || lots > 1000) return fail(400, 'invalid_input', 'stakeLots must be 1-1000');
    const stake = lots * g.currency!.rate.units;
    // A room with the same stake that still has a place and time for a whole shift: join it.
    let room = rooms()
      .values()
      .find(
        (r) =>
          r.settledAt === null &&
          r.stakeLots === lots &&
          r.slots.length < ORDER_PLAYERS &&
          r.closesAt - now > ORDER_SHIFT_MS + ORDER_GRACE_MS &&
          !r.slots.some((id) => shifts().get(id)?.accountId === accountId),
      );
    if (!room) {
      const rid = randomId('room');
      room = rooms().put(rid, { id: rid, seed: Math.floor(Math.random() * 0xffffffff) >>> 0, stakeLots: lots, stake, createdAt: now, closesAt: now + ORDER_ROOM_MS, slots: [], settledAt: null });
    }
    const id = randomId('shift');
    const startTx = stakeIn(accountId, id, lots, `order:${requestId}`);
    const row: ShiftRow = { ...base, id, mode, roomId: room.id, seed: room.seed, slot: room.slots.length, stakeLots: lots, stake, startTx };
    shifts().put(id, row);
    room = rooms().put(room.id, { ...room, slots: [...room.slots, id] });
    if (s.devSettings.sparring) addTestPlayers(room);
    return view(row);
  });

  s.route('GET', '/v1/order/shifts/{id}', ({ req, params }): OrderView => view(mine(s.accountIdFor(req), params[0])));

  s.route('POST', '/v1/order/shifts/{id}/finish', ({ req, params }): OrderView => {
    const row = advance(mine(s.accountIdFor(req), params[0]));
    if (row.finished) return view(row); // repeated request: the same answer, nothing counted twice
    const body = (req.body ?? {}) as { actions?: unknown; endAt?: unknown };
    const actions = cleanOrderActions(body.actions);
    if (!actions) return fail(400, 'invalid_input', 'actions must be whole-number times within the shift, in order');
    const endAt = body.endAt;
    if (typeof endAt !== 'number' || !Number.isInteger(endAt) || endAt < 0 || endAt > ORDER_SHIFT_MS) return fail(400, 'invalid_input', 'endAt must be a time within the shift');
    // Actions from the future of this shift cannot be.
    const elapsed = s.now() - row.startedAt + CLOCK_SLACK_MS;
    if (actions.some((a) => a.t > elapsed) || endAt > elapsed) return fail(400, 'invalid_input', 'The shift has not got that far');
    return view(finish(row, actions, endAt, false));
  });

  return {
    items: (accountId) =>
      shifts()
        .values()
        .filter((r) => r.accountId === accountId)
        .map(advance)
        .filter((r) => r.finished && (r.mode === 'training' || r.settlement || r.abandoned))
        .map((r): HistoryItem => {
          const v = view(r);
          const place = r.settlement?.place ?? v.place;
          return {
            id: r.id,
            game: 'order',
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            outcome: r.abandoned && !r.settlement ? 'abandoned' : r.settlement?.refunded ? 'draw' : place === 1 ? 'win' : 'loss',
            place: r.abandoned && !r.settlement ? null : place,
            players: r.settlement?.players ?? (r.mode === 'training' ? ORDER_PLAYERS : 1 + v.rivals.length),
            mode: r.mode === 'training' ? 'bot' : 'pvp',
            opponent: null,
            turns: null,
            stake: r.stake,
            net: r.settlement?.net ?? 0,
          };
        }),
    view: (accountId, id) => {
      const row = shifts().get(id);
      return row && row.accountId === accountId ? view(row) : null;
    },
  };
}
