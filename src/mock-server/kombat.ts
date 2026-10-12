// Market Kombat on the server stub: matching players, the turn timer,
// hidden moves, playing turns out with the shared rules (src/game/kombat.ts)
// and settling stakes. A bot fight is training: no stakes, nothing to win.

import { CHARACTER_IDS, KOMBAT_BOOST_PACKS, PLATFORM_ACCOUNT, PLATFORM_FEE_PERCENT } from '../api/contract';
import type {
  CharacterId,
  Gender,
  GameEntry,
  KombatBoost,
  KombatMode,
  KombatMove,
  KombatSettlement,
  KombatStatus,
  KombatView,
  Profile,
  WalletTx,
} from '../api/contract';
import { botMove, canUse, createKombat, forfeit, KOMBAT_MAX_TURNS, KOMBAT_MOVES, KOMBAT_TURN_MS, KombatState, resolveTurn } from '../game/kombat';
import { nextInt, seedFrom } from '../game/rng';
import { WELCOME_BONUS } from '../wallet/ledger';
import { fail, randomId } from './errors';
import type { MockServer } from './server';

/** A pvp fight nobody joined within this time is cancelled and the stake returned. */
export const KOMBAT_WAIT_MS = 2 * 60 * 1000;
/** The test opponent (developer panel) joins after this long. */
const SPARRING_DELAY_MS = 1500;
export const SPARRING_ACCOUNT = 'acc_sparring';
const BOT = 'bot';

interface Side {
  accountId: string;
  nickname: string;
  character: CharacterId;
  gender: Gender;
  requestId: string;
}

interface FightRow {
  id: string;
  mode: KombatMode;
  status: KombatStatus;
  sides: [Side, Side | null];
  stakeLots: number;
  stake: number;
  createdAt: number;
  seed: number;
  state: KombatState | null;
  deadline: number | null;
  /** Moves chosen for the current turn; never shown to the other side before the turn is played. */
  moves: [KombatMove | null, KombatMove | null];
  settlements: [KombatSettlement | null, KombatSettlement | null];
}

export function registerKombatRoutes(s: MockServer) {
  const fights = () => s.db.table<FightRow>('fights');
  const boosts = () => s.db.table<KombatBoost>('boosts');
  const game = (): GameEntry => s.game('kombat');

  const sideOf = (f: FightRow, accountId: string): 0 | 1 | null =>
    f.sides[0].accountId === accountId ? 0 : f.sides[1]?.accountId === accountId ? 1 : null;

  const isComputer = (side: Side | null) => !!side && (side.accountId === BOT || side.accountId === SPARRING_ACCOUNT);

  /** Uses one boosted fight of the player, if they have any left. */
  const takeBoost = (accountId: string): boolean => {
    const b = boosts().get(accountId);
    if (!b || b.fightsLeft <= 0) return false;
    boosts().put(accountId, { fightsLeft: b.fightsLeft - 1 });
    return true;
  };

  /** Gives the fight chips of one side back as ABIE: `back` chips at the game rate. */
  const payBack = (f: FightRow, i: 0 | 1, back: number): { payout: number; tx: WalletTx | null } => {
    const side = f.sides[i]!;
    const g = game();
    const { abie, units } = g.currency!.rate;
    if (back <= 0) return { payout: 0, tx: null };
    s.currencyPost(side.accountId, g.id, { id: `settle:${f.id}:${i}`, kind: 'settle', amount: back, ref: f.id });
    s.currencyPost(side.accountId, g.id, { id: `convert:${f.id}:${i}`, kind: 'convert', amount: -back, ref: f.id });
    const payout = Math.round((back * abie) / units);
    if (payout <= 0) return { payout: 0, tx: null };
    const now = s.now();
    const tx = s.wallet.post(side.accountId, { id: `return:${f.id}:${i}`, kind: 'currency_return', amount: payout, ref: f.id }, now);
    s.wallet.post(PLATFORM_ACCOUNT, { id: `payout:${f.id}:${i}`, kind: 'currency_payout', amount: -payout, ref: side.accountId }, now);
    return { payout, tx };
  };

  /** Settles a finished fight: the winner takes both stakes, the platform keeps PLATFORM_FEE_PERCENT of the win. */
  const settle = (f: FightRow): FightRow => {
    const st = f.state!;
    const winner = st.winner ?? null;
    const reason = st.reason ?? 'turns';
    const settlements: [KombatSettlement | null, KombatSettlement | null] = [null, null];
    for (const i of [0, 1] as const) {
      const side = f.sides[i];
      if (!side || side.accountId === BOT) continue;
      if (f.mode === 'bot') {
        settlements[i] = { winner, reason, stake: 0, back: 0, fee: 0, payout: 0, net: 0, tx: null };
        continue;
      }
      const won = winner === i;
      const draw = winner === null;
      const fee = won ? Math.ceil((f.stake * PLATFORM_FEE_PERCENT) / 100) : 0;
      const back = draw ? f.stake : won ? 2 * f.stake - fee : 0;
      const { payout, tx } = payBack(f, i, back);
      const net = payout - f.stakeLots * game().currency!.rate.abie;
      settlements[i] = { winner, reason, stake: f.stake, back, fee, payout, net, tx };
      const p = s.profile(side.accountId);
      s.saveProfile({ ...p, stats: { matches: p.stats.matches + 1, wins: p.stats.wins + (won ? 1 : 0), earned: p.stats.earned + net } });
    }
    return { ...f, status: 'finished', deadline: null, moves: [null, null], settlements };
  };

  /** The computer side's move (training bot, or the test opponent). */
  const computerMove = (f: FightRow, i: 0 | 1): FightRow => {
    const { move, state } = botMove(f.state!, i);
    const moves = [...f.moves] as FightRow['moves'];
    moves[i] = move;
    return { ...f, state, moves };
  };

  const playTurn = (f: FightRow): FightRow => {
    let g = f;
    for (const i of [0, 1] as const) {
      if (g.moves[i] === null) g = isComputer(g.sides[i]) ? computerMove(g, i) : { ...g, moves: (i === 0 ? ['block', g.moves[1]] : [g.moves[0], 'block']) as FightRow['moves'] };
    }
    const state = resolveTurn(g.state!, [g.moves[0]!, g.moves[1]!]);
    const next: FightRow = { ...g, state, moves: [null, null], deadline: state.finished ? null : s.now() + KOMBAT_TURN_MS };
    return state.finished ? settle(next) : next;
  };

  const sparringProfile = (): Profile => {
    const existing = s.db.table<Profile>('profiles').get(SPARRING_ACCOUNT);
    if (existing) return s.profile(SPARRING_ACCOUNT);
    const p: Profile = {
      accountId: SPARRING_ACCOUNT,
      nickname: 'Sparring',
      character: 'yandos',
      gender: 'm',
      genderChangedAt: null,
      skins: [...CHARACTER_IDS],
      stats: { matches: 0, wins: 0, earned: 0 },
      respect: { points: 0, level: 0 },
    };
    s.db.table<Profile>('profiles').put(SPARRING_ACCOUNT, p);
    return p;
  };

  /** Stakes `lots` of fight chips for a side: buys what is missing, then moves the chips into the fight. */
  const stakeIn = (accountId: string, fightId: string, lots: number, key: string) => {
    const g = game();
    const { units } = g.currency!.rate;
    const stake = lots * units;
    const missing = stake - s.currencyLedger(accountId, g.id).balance;
    const tx = missing > 0 ? s.buyCurrency(accountId, g, Math.ceil(missing / units), key) : null;
    s.currencyPost(accountId, g.id, { id: `stake:${fightId}:${accountId}`, kind: 'stake', amount: -stake, ref: fightId });
    return tx;
  };

  const start = (f: FightRow, sides: [Side, Side]): FightRow => {
    const boosted = f.mode === 'pvp' ? [takeBoost(sides[0].accountId), sides[1].accountId === SPARRING_ACCOUNT ? false : takeBoost(sides[1].accountId)] : [false, false];
    const state = createKombat(f.seed, { character: sides[0].character, boosted: boosted[0] }, { character: sides[1].character, boosted: boosted[1] });
    return { ...f, sides, status: 'active', state, deadline: s.now() + KOMBAT_TURN_MS };
  };

  /** Brings a fight up to the present: joins, cancels, and turns whose timer ran out. */
  const advance = (f: FightRow): FightRow => {
    let g = f;
    const now = s.now();
    if (g.status === 'waiting') {
      if (now - g.createdAt > KOMBAT_WAIT_MS) {
        const { tx, payout } = payBack(g, 0, g.stake);
        const st: KombatSettlement = { winner: null, reason: 'forfeit', stake: g.stake, back: g.stake, fee: 0, payout, net: 0, tx };
        g = { ...g, status: 'cancelled', settlements: [st, null] };
      } else if (s.devSettings.sparring && now - g.createdAt >= SPARRING_DELAY_MS) {
        const p = sparringProfile();
        // The test opponent pays its stake like anyone else; in the developer panel it never runs dry.
        if (s.wallet.balance(SPARRING_ACCOUNT) < g.stakeLots * game().currency!.rate.abie) {
          s.wallet.post(SPARRING_ACCOUNT, { id: `sparring-topup:${g.id}`, kind: 'welcome', amount: Math.max(WELCOME_BONUS, g.stakeLots * game().currency!.rate.abie) }, now);
        }
        stakeIn(SPARRING_ACCOUNT, g.id, g.stakeLots, `kombat:${g.id}`);
        const [r] = nextInt(seedFrom(g.id), 0, 2);
        const character = CHARACTER_IDS.filter((c) => c !== g.sides[0].character)[r];
        g = start(g, [g.sides[0], { accountId: SPARRING_ACCOUNT, nickname: p.nickname, character, gender: 'm', requestId: g.id }]);
      }
    }
    let guard = 0;
    while (g.status === 'active' && g.deadline !== null && now >= g.deadline && guard++ <= KOMBAT_MAX_TURNS) g = playTurn(g);
    if (g !== f) fights().put(g.id, g);
    return g;
  };

  const view = (f: FightRow, me: 0 | 1): KombatView => {
    const fighter = (i: 0 | 1) => {
      const side = f.sides[i];
      if (!side) return null;
      const st = f.state?.fighters[i];
      return {
        nickname: side.accountId === BOT ? '' : side.nickname,
        character: side.character,
        gender: side.gender,
        isBot: side.accountId === BOT,
        hp: Math.max(0, st?.hp ?? 100),
        energy: st?.energy ?? 0,
        combo: st?.combo ?? 0,
        boosted: st?.boosted ?? false,
      };
    };
    const last = f.state?.log[f.state.log.length - 1] ?? null;
    return {
      id: f.id,
      mode: f.mode,
      status: f.status,
      you: me,
      fighters: [fighter(0)!, fighter(1)],
      turn: f.state?.turn ?? 1,
      maxTurns: KOMBAT_MAX_TURNS,
      turnMs: KOMBAT_TURN_MS,
      deadline: f.status === 'active' ? f.deadline : null,
      serverNow: s.now(),
      myMove: f.moves[me],
      last: last ? { turn: last.turn, moves: last.moves, damage: last.damage, crit: last.crit, healed: last.healed, drained: last.drained } : null,
      stake: f.stake,
      stakeLots: f.stakeLots,
      settlement: f.settlements[me],
    };
  };

  const mine = (accountId: string, id: string): { f: FightRow; me: 0 | 1 } => {
    const f = fights().get(id);
    const me = f ? sideOf(f, accountId) : null;
    if (!f || me === null) return fail(404, 'not_found', 'Unknown fight');
    return { f: advance(f), me };
  };

  s.route('POST', '/v1/kombat/fights', ({ req }): KombatView => {
    const accountId = s.accountIdFor(req);
    const g = game();
    const p = s.playable(accountId, g);
    const body = (req.body ?? {}) as { mode?: unknown; stakeLots?: unknown; requestId?: unknown };
    if (body.mode !== 'bot' && body.mode !== 'pvp') return fail(400, 'invalid_input', 'mode must be bot or pvp');
    if (typeof body.requestId !== 'string' || !body.requestId) return fail(400, 'invalid_input', 'requestId is required');
    const requestId = body.requestId;

    // The same request again, or a fight this player is still in: that fight.
    for (const f0 of fights().values()) {
      const me = sideOf(f0, accountId);
      if (me === null) continue;
      const f = advance(f0);
      if (f.sides[me]?.requestId === requestId || f.status === 'waiting' || f.status === 'active') return view(f, me);
    }

    const me: Side = { accountId, nickname: p.nickname, character: p.character!, gender: p.gender ?? 'm', requestId };
    const id = randomId('fight');
    const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const base: FightRow = {
      id,
      mode: body.mode,
      status: 'waiting',
      sides: [me, null],
      stakeLots: 0,
      stake: 0,
      createdAt: s.now(),
      seed,
      state: null,
      deadline: null,
      moves: [null, null],
      settlements: [null, null],
    };

    if (body.mode === 'bot') {
      // Training: no stake, no chips, nothing to win.
      const [r] = nextInt(seed, 0, 2);
      const character = CHARACTER_IDS.filter((c) => c !== me.character)[r];
      const f = start(base, [me, { accountId: BOT, nickname: '', character, gender: 'm', requestId }]);
      fights().put(id, f);
      return view(f, 0);
    }

    const lots = body.stakeLots;
    if (typeof lots !== 'number' || !Number.isInteger(lots) || lots < 1 || lots > 1000) return fail(400, 'invalid_input', 'stakeLots must be 1-1000');
    const stake = lots * g.currency!.rate.units;
    // Someone waiting with the same stake: join them.
    const open = fights()
      .values()
      .map(advance)
      .find((f) => f.mode === 'pvp' && f.status === 'waiting' && f.stakeLots === lots && f.sides[0].accountId !== accountId);
    if (open) {
      stakeIn(accountId, open.id, lots, `kombat:${requestId}`);
      const f = start(open, [open.sides[0], me]);
      fights().put(f.id, f);
      return view(f, 1);
    }
    stakeIn(accountId, id, lots, `kombat:${requestId}`);
    const f = { ...base, stakeLots: lots, stake };
    fights().put(id, f);
    return view(f, 0);
  });

  s.route('GET', '/v1/kombat/fights/{id}', ({ req, params }): KombatView => {
    const { f, me } = mine(s.accountIdFor(req), params[0]);
    return view(f, me);
  });

  s.route('POST', '/v1/kombat/fights/{id}/move', ({ req, params }): KombatView => {
    const { f, me } = mine(s.accountIdFor(req), params[0]);
    const body = (req.body ?? {}) as { turn?: unknown; move?: unknown };
    if (f.status !== 'active' || !f.state) return fail(409, 'conflict', 'The fight is not going on');
    if (body.turn !== f.state.turn) return fail(409, 'conflict', 'That turn is already over');
    if (!KOMBAT_MOVES.includes(body.move as KombatMove)) return fail(400, 'invalid_input', 'Unknown move');
    const move = body.move as KombatMove;
    if (!canUse(f.state.fighters[me], move)) return fail(400, 'invalid_input', 'Not enough energy for the special move');
    if (f.moves[me]) return view(f, me); // a move, once chosen, stays
    const moves = [...f.moves] as FightRow['moves'];
    moves[me] = move;
    let g: FightRow = { ...f, moves };
    const other = (me === 0 ? 1 : 0) as 0 | 1;
    // The computer (or the test opponent) answers at once; then the turn is played without waiting.
    if (isComputer(g.sides[other]) && !g.moves[other]) g = computerMove(g, other);
    if (g.moves[0] && g.moves[1]) g = playTurn(g);
    fights().put(g.id, g);
    return view(g, me);
  });

  s.route('POST', '/v1/kombat/fights/{id}/leave', ({ req, params }): KombatView => {
    const { f, me } = mine(s.accountIdFor(req), params[0]);
    let g = f;
    if (f.status === 'waiting') {
      const { tx, payout } = payBack(f, 0, f.stake);
      const st: KombatSettlement = { winner: null, reason: 'forfeit', stake: f.stake, back: f.stake, fee: 0, payout, net: 0, tx };
      g = { ...f, status: 'cancelled', settlements: [st, null] };
    } else if (f.status === 'active' && f.state) {
      g = settle({ ...f, state: forfeit(f.state, me) });
    }
    fights().put(g.id, g);
    return view(g, me);
  });

  s.route('GET', '/v1/kombat/boost', ({ req }): KombatBoost => {
    const accountId = s.accountIdFor(req);
    return boosts().get(accountId) ?? { fightsLeft: 0 };
  });

  s.route('POST', '/v1/kombat/boost', ({ req }) => {
    const accountId = s.accountIdFor(req);
    const body = (req.body ?? {}) as { pack?: unknown; requestId?: unknown };
    const pack = KOMBAT_BOOST_PACKS.find((p) => p.id === body.pack);
    if (!pack) return fail(400, 'invalid_input', 'Unknown pack');
    if (typeof body.requestId !== 'string' || !body.requestId) return fail(400, 'invalid_input', 'requestId is required');
    const txId = `boost:${accountId}:${body.requestId}`;
    const repeated = s.wallet.has(accountId, txId);
    const now = s.now();
    const tx = s.wallet.post(accountId, { id: txId, kind: 'kombat_boost', amount: -pack.price, ref: pack.id }, now);
    s.wallet.post(PLATFORM_ACCOUNT, { id: `boostsale:${accountId}:${body.requestId}`, kind: 'currency_sale', amount: pack.price, ref: accountId }, now);
    const before = boosts().get(accountId) ?? { fightsLeft: 0 };
    const boost = repeated ? before : boosts().put(accountId, { fightsLeft: before.fightsLeft + pack.fights });
    return { tx, boost };
  });
}
