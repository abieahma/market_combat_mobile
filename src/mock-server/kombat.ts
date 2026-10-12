// Market Kombat on the server stub: matching players, the turn timer, hidden
// hands and plays, playing turns out with the shared rules
// (src/game/kombat.ts) and settling stakes. A bot fight is training: no
// stakes, nothing to win.

import { CHARACTER_IDS, KOMBAT_BOOST_PACKS, PLATFORM_ACCOUNT, PLATFORM_FEE_PERCENT } from '../api/contract';
import type {
  CharacterId,
  Gender,
  GameEntry,
  HistoryItem,
  KombatBoost,
  KombatMode,
  KombatPlay,
  KombatSettlement,
  KombatStatus,
  KombatView,
  Profile,
  WalletTx,
} from '../api/contract';
import {
  botPlay,
  createKombat,
  forfeit,
  isStunned,
  KOMBAT_MAX_HP,
  KOMBAT_MAX_TURNS,
  KOMBAT_RULES,
  KOMBAT_START_ENERGY,
  KOMBAT_TURN_MS,
  KombatState,
  playProblem,
  resolveTurn,
} from '../game/kombat';
import { nextInt, seedFrom } from '../game/rng';
import { WELCOME_BONUS } from '../wallet/ledger';
import { fail, randomId } from './errors';
import type { MockServer } from './server';

/** A pvp fight nobody joined within this time is cancelled and the stake returned. */
export const KOMBAT_WAIT_MS = 2 * 60 * 1000;
/** The test opponent (developer panel) joins after this long. */
const SPARRING_DELAY_MS = 1500;
/** A stunned player against the computer sees the stun this long before the turn is played. */
const STUN_PAUSE_MS = 2500;
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
  /** Rules version the fight is played by; rows of older rules are reset. */
  rules: number;
  mode: KombatMode;
  status: KombatStatus;
  sides: [Side, Side | null];
  stakeLots: number;
  stake: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  seed: number;
  state: KombatState | null;
  deadline: number | null;
  /** Plays chosen for the current turn; never shown to the other side before the turn is played. */
  plays: [KombatPlay | null, KombatPlay | null];
  settlements: [KombatSettlement | null, KombatSettlement | null];
}

/** What the history needs from the fights. */
export interface KombatHistory {
  items(accountId: string): HistoryItem[];
  view(accountId: string, id: string): KombatView | null;
}

function isPlay(x: unknown): x is KombatPlay {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  if (p.kind === 'rest') return p.discard === undefined || typeof p.discard === 'string';
  return p.kind === 'card' && typeof p.card === 'string' && (p.as === undefined || typeof p.as === 'string');
}

export function registerKombatRoutes(s: MockServer): KombatHistory {
  const boosts = () => s.db.table<KombatBoost>('boosts');
  const game = (): GameEntry => s.game('kombat');
  let resetDone = false;

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

  /**
   * Fights of older rules cannot go on with the new cards: they are removed
   * once, and the stakes of fights still waiting or going on come back.
   */
  const fights = () => {
    const table = s.db.table<FightRow>('fights');
    if (resetDone) return table;
    resetDone = true;
    for (const f of table.values()) {
      if (f.rules === KOMBAT_RULES) continue;
      if (f.mode === 'pvp' && (f.status === 'waiting' || f.status === 'active')) {
        for (const i of [0, 1] as const) if (f.sides[i] && f.sides[i]!.accountId !== BOT) payBack(f, i, f.stake);
      }
      table.delete(f.id);
    }
    return table;
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
    return { ...f, status: 'finished', deadline: null, finishedAt: s.now(), plays: [null, null], settlements };
  };

  /** The computer side's play (training bot, or the test opponent). */
  const computerPlay = (f: FightRow, i: 0 | 1): FightRow => {
    const { play, state } = botPlay(f.state!, i);
    const plays = [...f.plays] as FightRow['plays'];
    plays[i] = play;
    return { ...f, state, plays };
  };

  /** A side is ready when it has played, is the computer, or is stunned (a stunned fighter skips the turn). */
  const ready = (f: FightRow, i: 0 | 1) => f.plays[i] !== null || isComputer(f.sides[i]) || isStunned(f.state!.fighters[i]);

  const playTurn = (f: FightRow): FightRow => {
    let g = f;
    for (const i of [0, 1] as const) if (g.plays[i] === null && isComputer(g.sides[i]) && !isStunned(g.state!.fighters[i])) g = computerPlay(g, i);
    // A player who did not choose in time misses the turn.
    const state = resolveTurn(g.state!, g.plays, s.now());
    const next: FightRow = { ...g, state, plays: [null, null], deadline: state.finished ? null : s.now() + KOMBAT_TURN_MS };
    return state.finished ? settle(next) : next;
  };

  const sparringProfile = (): Profile => {
    const existing = s.db.table<Profile>('profiles').get(SPARRING_ACCOUNT);
    if (existing) return s.profile(SPARRING_ACCOUNT);
    const p: Profile = {
      accountId: SPARRING_ACCOUNT,
      nickname: 'Sparring',
      character: 'yandos',
      inUniverse: true,
      country: null,
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
    const now = s.now();
    return { ...f, sides, status: 'active', state, startedAt: now, deadline: now + KOMBAT_TURN_MS };
  };

  /** Brings a fight up to the present: joins, cancels, stunned turns and turns whose timer ran out. */
  const advance = (f: FightRow): FightRow => {
    let g = f;
    const now = s.now();
    if (g.status === 'waiting') {
      if (now - g.createdAt > KOMBAT_WAIT_MS) {
        const { tx, payout } = payBack(g, 0, g.stake);
        const st: KombatSettlement = { winner: null, reason: 'forfeit', stake: g.stake, back: g.stake, fee: 0, payout, net: 0, tx };
        g = { ...g, status: 'cancelled', finishedAt: now, settlements: [st, null] };
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
    while (g.status === 'active' && g.deadline !== null && guard++ <= KOMBAT_MAX_TURNS) {
      const overdue = now >= g.deadline;
      // Everyone who can play has played (a stunned player against the computer, say): no need to wait for the timer.
      const allReady = ready(g, 0) && ready(g, 1) && now >= g.deadline - KOMBAT_TURN_MS + STUN_PAUSE_MS;
      if (!overdue && !allReady) break;
      g = playTurn(g);
    }
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
        hp: Math.max(0, st?.hp ?? KOMBAT_MAX_HP),
        energy: st?.energy ?? KOMBAT_START_ENERGY,
        combo: st?.combo ?? 0,
        boosted: st?.boosted ?? false,
        effects: st?.effects ?? [],
        lastSuit: st?.lastSuit ?? null,
        handSize: st?.hand.length ?? 0,
        deckSize: st?.deck.length ?? 0,
      };
    };
    return {
      id: f.id,
      mode: f.mode,
      status: f.status,
      rules: f.rules,
      you: me,
      fighters: [fighter(0)!, fighter(1)],
      turn: f.state?.turn ?? 1,
      maxTurns: KOMBAT_MAX_TURNS,
      turnMs: KOMBAT_TURN_MS,
      deadline: f.status === 'active' ? f.deadline : null,
      serverNow: s.now(),
      createdAt: f.createdAt,
      startedAt: f.startedAt,
      finishedAt: f.finishedAt,
      hand: f.state?.fighters[me].hand ?? [],
      myPlay: f.plays[me],
      log: f.state?.log ?? [],
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
      rules: KOMBAT_RULES,
      mode: body.mode,
      status: 'waiting',
      sides: [me, null],
      stakeLots: 0,
      stake: 0,
      createdAt: s.now(),
      startedAt: null,
      finishedAt: null,
      seed,
      state: null,
      deadline: null,
      plays: [null, null],
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
    const body = (req.body ?? {}) as { turn?: unknown; play?: unknown };
    if (f.status !== 'active' || !f.state) return fail(409, 'conflict', 'The fight is not going on');
    if (body.turn !== f.state.turn) return fail(409, 'conflict', 'That turn is already over');
    if (!isPlay(body.play)) return fail(400, 'invalid_input', 'play must be a card or a rest');
    const play = body.play;
    if (f.plays[me]) return view(f, me); // a play, once chosen, stays
    if (isStunned(f.state.fighters[me])) return fail(409, 'conflict', 'Stunned: this turn is skipped');
    const problem = playProblem(f.state.fighters[me], play);
    if (problem === 'not_in_hand') return fail(400, 'invalid_input', 'That card is not in your hand');
    if (problem === 'joker') return fail(400, 'invalid_input', 'The joker must name a card');
    if (problem === 'energy') return fail(400, 'invalid_input', 'Not enough energy for that card');
    const plays = [...f.plays] as FightRow['plays'];
    plays[me] = play.kind === 'rest' ? (play.discard ? { kind: 'rest', discard: play.discard } : { kind: 'rest' }) : play.as ? { kind: 'card', card: play.card, as: play.as } : { kind: 'card', card: play.card };
    let g: FightRow = { ...f, plays };
    const other = (me === 0 ? 1 : 0) as 0 | 1;
    // The computer (or the test opponent) answers at once; then the turn is played without waiting.
    if (isComputer(g.sides[other]) && !g.plays[other] && !isStunned(g.state!.fighters[other])) g = computerPlay(g, other);
    if (ready(g, 0) && ready(g, 1)) g = playTurn(g);
    fights().put(g.id, g);
    return view(g, me);
  });

  s.route('POST', '/v1/kombat/fights/{id}/leave', ({ req, params }): KombatView => {
    const { f, me } = mine(s.accountIdFor(req), params[0]);
    let g = f;
    if (f.status === 'waiting') {
      const { tx, payout } = payBack(f, 0, f.stake);
      const st: KombatSettlement = { winner: null, reason: 'forfeit', stake: f.stake, back: f.stake, fee: 0, payout, net: 0, tx };
      g = { ...f, status: 'cancelled', finishedAt: s.now(), settlements: [st, null] };
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

  return {
    items: (accountId) =>
      fights()
        .values()
        .filter((f) => sideOf(f, accountId) !== null)
        .map(advance)
        .filter((f) => f.status === 'finished' || f.status === 'cancelled')
        .map((f): HistoryItem => {
          const me = sideOf(f, accountId)!;
          const them = f.sides[me === 0 ? 1 : 0];
          const st = f.settlements[me];
          const winner = st?.winner ?? null;
          return {
            id: f.id,
            game: 'kombat',
            startedAt: f.startedAt ?? f.createdAt,
            finishedAt: f.finishedAt,
            outcome: f.status === 'cancelled' ? 'cancelled' : winner === null ? 'draw' : winner === me ? 'win' : 'loss',
            place: null,
            players: 2,
            mode: f.mode,
            opponent: them ? { nickname: them.accountId === BOT ? '' : them.nickname, character: them.character, gender: them.gender, isBot: them.accountId === BOT } : null,
            turns: f.state?.log.length ?? 0,
            stake: f.stake,
            net: st?.net ?? 0,
          };
        }),
    view: (accountId, id) => {
      const f = fights().get(id);
      const me = f ? sideOf(f, accountId) : null;
      return f && me !== null ? view(advance(f), me) : null;
    },
  };
}
