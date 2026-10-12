// Server stub: answers the routes of src/api/contract.ts the way the future
// Go server will. It runs inside the app and keeps its own data, separate
// from the app's cache. The parts that stand in for the outside world
// (email delivery, the Telegram bot, Google) are under `dev`.

import {
  CHARACTER_CHANGE_COST,
  CHARACTER_IDS,
  CharacterId,
  currentCharacterId,
  FREE_SKINS,
  Gender,
  GENDER_CHANGE_COOLDOWN_MS,
  NICKNAME_MAX,
  NICKNAME_MIN,
  ENTRY_FEE_PERCENT,
  PLATFORM_ACCOUNT,
  PLATFORM_FEE_PERCENT,
} from '../api/contract';
import type {
  Account,
  AuthProvider,
  AuthResult,
  ChallengeStarted,
  ChallengeStatus,
  CurrencyBuyResult,
  EntryResult,
  GameCurrencyBalance,
  GameEntry,
  GameId,
  GameList,
  Identity,
  MatchFinished,
  MatchFinishRequest,
  MatchStarted,
  Profile,
  Proposal,
  ProposalStatus,
  WalletTx,
  WalletView,
} from '../api/contract';
import type { ApiRequest, ApiResponse } from '../api/transport';
import { MATCH_SECONDS } from '../game/duel';
import { emptyLedger, LedgerState, post, WELCOME_BONUS } from '../wallet/ledger';
import { Database, KeyValue } from './db';
import { fail, randomId, ServerError } from './errors';
import { gameEntryProblem, normalizeGame, PUBLISHED_GAMES } from './games';
import { registerKombatRoutes } from './kombat';
import { moderate, registerProposalRoutes } from './proposals';
import { WalletError, WalletService } from './wallet-service';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_RESEND_MS = 30 * 1000;
export const EMAIL_MAX_ATTEMPTS = 5;
export const BOT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const TELEGRAM_BOT = 'MarketCombatBot';
/** A match not finished this long after its start is closed by the server (stake refunded). */
export const MATCH_STALE_MS = (MATCH_SECONDS + 3) * 1000 + 2 * 60 * 1000;
/** Upper bound for the equity a client may report: stake × this. */
const MAX_EQUITY_MULTIPLE = 100;

type AccountRow = Account;
interface SessionRow {
  accountId: string;
  expiresAt: number;
}
interface ChallengeRow {
  id: string;
  kind: 'email' | 'telegram' | 'phone';
  expiresAt: number;
  status: 'pending' | 'confirmed' | 'consumed';
  email?: string;
  code?: string;
  attempts?: number;
  sentAt?: number;
  nonce?: string;
  result?: AuthResult;
}
interface MatchRow {
  id: string;
  accountId: string;
  game: GameId;
  seed: number;
  startedAt: number;
  requestId: string;
  stake: number;
  stakeLots: number;
  startTx: WalletTx | null;
  finished?: MatchFinished;
}

/** Game currency ledger kinds: bought, put into a match, returned by a match, turned back into ABIE. */
export type CurrencyKind = 'buy' | 'stake' | 'settle' | 'convert';

/** Messages "delivered" to the player outside the game. */
export interface InboxMessage {
  id: string;
  ts: number;
  channel: 'email';
  to: string;
  kind: 'login_code';
  code: string;
}

export { ServerError, fail, randomId };

function sixDigits(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? email : null;
}

export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^\d]/g, '');
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
}

export function maskPhone(e164: string): string {
  return `${e164.slice(0, e164.length - 10)} ••• ••• ${e164.slice(-4, -2)} ${e164.slice(-2)}`;
}

type Handler = (ctx: { req: ApiRequest; params: string[]; query: Record<string, string> }) => Promise<unknown> | unknown;

export class MockServer {
  /** Game server database. Route modules (proposals, kombat) use it too. */
  readonly db: Database;
  private readonly devDb: Database;
  readonly wallet: WalletService;
  private readonly routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
  private readonly inboxListeners = new Set<(m: InboxMessage) => void>();
  now: () => number = () => Date.now();
  /** Switches of the developer panel that change how the stub behaves. */
  devSettings = { sparring: false };

  constructor(kv: KeyValue) {
    this.db = new Database(kv, 'game', [
      'accounts',
      'identities',
      'sessions',
      'profiles',
      'challenges',
      'matches',
      'games',
      'currency',
      'entries',
      'proposals',
      'fights',
      'boosts',
    ]);
    this.devDb = new Database(kv, 'outside', ['inbox']);
    this.wallet = new WalletService(kv);
    this.registerRoutes();
    registerProposalRoutes(this);
    registerKombatRoutes(this);
  }

  // ------------------------------------------------------------ plumbing

  route(method: string, path: string, handler: Handler) {
    const pattern = new RegExp('^' + path.replace(/\{[^}]+\}/g, '([^/]+)') + '$');
    this.routes.push({ method, pattern, handler });
  }

  private async openAll() {
    await Promise.all([this.db.open(), this.devDb.open(), this.wallet.open()]);
    // Games are published once; an entry already in the registry is never replaced.
    const registry = this.db.table<GameEntry>('games');
    for (const g of PUBLISHED_GAMES) if (!registry.get(g.id)) registry.put(g.id, g);
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    await this.openAll();
    const [pathOnly, queryString = ''] = req.path.split('?');
    const query: Record<string, string> = {};
    for (const part of queryString.split('&')) {
      if (!part) continue;
      const [k, v = ''] = part.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    try {
      for (const r of this.routes) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(pathOnly);
        if (!m) continue;
        const params = m.slice(1).map(decodeURIComponent);
        const body = await r.handler({ req, params, query });
        await Promise.all([this.db.flush(), this.devDb.flush(), this.wallet.flush()]);
        return { status: 200, body };
      }
      return { status: 404, body: { error: { code: 'not_found', message: `No route ${req.method} ${pathOnly}` } } };
    } catch (e) {
      await Promise.all([this.db.flush(), this.devDb.flush(), this.wallet.flush()]);
      if (e instanceof ServerError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
      if (e instanceof WalletError) {
        const status = e.code === 'insufficient_funds' ? 409 : 400;
        return { status, body: { error: { code: e.code === 'insufficient_funds' ? 'insufficient_funds' : 'invalid_input', message: e.message } } };
      }
      return { status: 500, body: { error: { code: 'internal', message: String(e) } } };
    }
  }

  accountIdFor(req: ApiRequest): string {
    if (!req.token) return fail(401, 'unauthorized', 'Sign in first');
    const s = this.db.table<SessionRow>('sessions').get(req.token);
    if (!s || s.expiresAt < this.now()) return fail(401, 'unauthorized', 'Session expired, sign in again');
    return s.accountId;
  }

  // ------------------------------------------------------------- accounts

  profile(accountId: string): Profile {
    const p = this.db.table<Profile>('profiles').get(accountId);
    if (!p) return fail(404, 'not_found', 'No profile');
    // Profiles saved before skins existed own the free ones; old character ids read as the new ones.
    const skins = Array.isArray(p.skins) ? p.skins.map((s) => currentCharacterId(s) ?? s) : [...FREE_SKINS];
    return { ...p, character: currentCharacterId(p.character), skins };
  }

  saveProfile(p: Profile): Profile {
    return this.db.table<Profile>('profiles').put(p.accountId, { ...p });
  }

  account(accountId: string): Account {
    const a = this.db.table<AccountRow>('accounts').get(accountId);
    return a ?? fail(404, 'not_found', 'No account');
  }

  // ------------------------------------------------- games and currencies

  game(id: unknown): GameEntry {
    const g = typeof id === 'string' ? this.db.table<GameEntry>('games').get(id) : undefined;
    return g ? normalizeGame(g) : fail(404, 'not_found', 'Unknown game');
  }

  /**
   * Puts a game into the registry. Allowed once per game id: after that the
   * entry, its universes, rate, entry price and author share never change.
   */
  publish(entry: GameEntry): GameEntry {
    const problem = gameEntryProblem(entry);
    if (problem) return fail(400, 'invalid_input', problem);
    const registry = this.db.table<GameEntry>('games');
    if (registry.get(entry.id)) return fail(409, 'conflict', 'This game is already published; its rate never changes');
    return registry.put(entry.id, normalizeGame({ ...entry }));
  }

  /** True when the player has paid the entry of this game (or it is free). */
  opened(accountId: string, game: GameEntry): boolean {
    return game.entry.kind === 'free' || !!this.db.table<unknown>('entries').get(`${accountId}:${game.id}`);
  }

  /** The game must be in the universe of the player's character and, if paid, opened. */
  playable(accountId: string, game: GameEntry): Profile {
    const p = this.profile(accountId);
    if (!p.character) return fail(409, 'conflict', 'Choose a character first');
    if (game.universes !== 'all' && !game.universes.includes(p.character)) return fail(403, 'forbidden', 'This game is not in your universe');
    if (!this.opened(accountId, game)) return fail(402, 'payment_required', 'Pay the entry of this game first');
    return p;
  }

  /** ABIE for the author of a game; nothing for the platform's own games. */
  private authorPart(game: GameEntry, amount: number, percent: number): number {
    return game.author ? Math.floor((amount * percent) / 100) : 0;
  }

  currencyLedger(accountId: string, game: GameId): LedgerState<CurrencyKind> {
    return this.db.table<LedgerState<CurrencyKind>>('currency').get(`${accountId}:${game}`) ?? emptyLedger<CurrencyKind>();
  }

  currencyPost(accountId: string, game: GameId, req: { id: string; kind: CurrencyKind; amount: number; ref?: string }) {
    const res = post(this.currencyLedger(accountId, game), req, this.now());
    if (!res.ok) return fail(409, res.error === 'insufficient_funds' ? 'insufficient_funds' : 'invalid_input', 'Game currency operation refused');
    if (!res.duplicate) this.db.table<LedgerState<CurrencyKind>>('currency').put(`${accountId}:${game}`, res.state);
    return res.tx;
  }

  currencyBalance(accountId: string, game: GameEntry): GameCurrencyBalance {
    return { game: game.id, code: game.currency!.code, balance: this.currencyLedger(accountId, game.id).balance };
  }

  /**
   * Buys `lots` of a game currency. One operation: ABIE leave the player for
   * the platform account, the currency arrives. Every part has an id derived
   * from `key`, so a repeat changes nothing.
   */
  buyCurrency(accountId: string, game: GameEntry, lots: number, key: string): WalletTx {
    const { abie, units } = game.currency!.rate;
    const now = this.now();
    const cost = lots * abie;
    const tx = this.wallet.post(accountId, { id: `buy:${game.id}:${key}`, kind: 'currency_buy', amount: -cost, ref: game.id }, now);
    // The author of the game gets their share of the purchase; the platform the rest.
    const toAuthor = this.authorPart(game, cost, game.authorShare);
    if (toAuthor > 0) this.wallet.post(game.author!.accountId, { id: `share:${accountId}:${game.id}:${key}`, kind: 'author_share', amount: toAuthor, ref: game.id }, now);
    if (cost - toAuthor > 0) this.wallet.post(PLATFORM_ACCOUNT, { id: `sale:${accountId}:${game.id}:${key}`, kind: 'currency_sale', amount: cost - toAuthor, ref: accountId }, now);
    this.currencyPost(accountId, game.id, { id: `buy:${key}`, kind: 'buy', amount: lots * units, ref: tx.id });
    return tx;
  }

  /**
   * Closes a match: what it returned goes back to ABIE at the game's rate.
   * The platform keeps PLATFORM_FEE_PERCENT of a profit and nothing of a loss.
   */
  private settle(m: MatchRow, place: number, equity: number, abandoned: boolean): MatchFinished {
    const game = this.game(m.game);
    const now = this.now();
    // Matches saved before stakes existed have none.
    const stake = m.stake ?? 0;
    const stakeLots = m.stakeLots ?? 0;
    const profit = equity - stake;
    let fee = 0;
    let payout = 0;
    let tx: WalletTx | null = null;
    if (game.currency) {
      const { abie, units } = game.currency.rate;
      fee = profit > 0 ? Math.ceil((profit * PLATFORM_FEE_PERCENT) / 100) : 0;
      const back = equity - fee;
      if (back > 0) {
        this.currencyPost(m.accountId, game.id, { id: `settle:${m.id}`, kind: 'settle', amount: back, ref: m.id });
        this.currencyPost(m.accountId, game.id, { id: `convert:${m.id}`, kind: 'convert', amount: -back, ref: m.id });
        payout = Math.round((back * abie) / units);
      }
      if (payout > 0) {
        tx = this.wallet.post(m.accountId, { id: `return:${m.id}`, kind: 'currency_return', amount: payout, ref: m.id }, now);
        this.wallet.post(PLATFORM_ACCOUNT, { id: `payout:${m.id}`, kind: 'currency_payout', amount: -payout, ref: m.accountId }, now);
      }
    }
    const net = payout - (game.currency ? stakeLots * game.currency.rate.abie : 0);
    const p = this.profile(m.accountId);
    const profile = abandoned
      ? p
      : this.saveProfile({
          ...p,
          stats: { matches: p.stats.matches + 1, wins: p.stats.wins + (place === 1 ? 1 : 0), earned: p.stats.earned + net },
        });
    const finished: MatchFinished = { matchId: m.id, place, stake, equity, profit, fee, payout, net, tx, profile };
    if (abandoned) finished.abandoned = true;
    this.db.table<MatchRow>('matches').put(m.id, { ...m, finished });
    return finished;
  }

  /** Matches left without a finish (app closed, phone off) get their stake back. */
  private settleStale(accountId: string) {
    const deadline = this.now() - MATCH_STALE_MS;
    for (const m of this.db.table<MatchRow>('matches').values()) {
      if (m.accountId === accountId && !m.finished && m.startedAt < deadline) this.settle(m, 4, m.stake ?? 0, true);
    }
  }

  /** Finds the account behind an identity or creates a new one. */
  private signIn(identity: Identity): AuthResult {
    const index = this.db.table<string>('identities');
    const key = `${identity.provider}:${identity.subject}`;
    let accountId = index.get(key);
    let isNew = false;
    const now = this.now();
    if (!accountId) {
      isNew = true;
      accountId = randomId('acc');
      this.db.table<AccountRow>('accounts').put(accountId, { id: accountId, createdAt: now, identities: [identity] });
      this.db.table<Profile>('profiles').put(accountId, {
        accountId,
        nickname: `Trader${Math.floor(1000 + Math.random() * 9000)}`,
        character: null,
        gender: null,
        genderChangedAt: null,
        skins: [...FREE_SKINS],
        stats: { matches: 0, wins: 0, earned: 0 },
        respect: { points: 0, level: 0 },
      });
      index.put(key, accountId);
      this.wallet.post(accountId, { id: `welcome:${accountId}`, kind: 'welcome', amount: WELCOME_BONUS }, now);
    }
    const token = randomId('tok', 32);
    const expiresAt = now + SESSION_TTL_MS;
    this.db.table<SessionRow>('sessions').put(token, { accountId, expiresAt });
    return { session: { token, expiresAt }, account: this.account(accountId), profile: this.profile(accountId), isNew };
  }

  private challenge(id: string): ChallengeRow {
    const c = this.db.table<ChallengeRow>('challenges').get(id);
    return c ?? fail(404, 'not_found', 'Unknown sign-in attempt');
  }

  private startBotChallenge(kind: 'telegram' | 'phone'): ChallengeStarted {
    const id = randomId('ch');
    const nonce = randomId('n', 20).slice(2);
    const expiresAt = this.now() + BOT_CHALLENGE_TTL_MS;
    this.db.table<ChallengeRow>('challenges').put(id, { id, kind, expiresAt, status: 'pending', nonce });
    const start = `${kind === 'phone' ? 'phone' : 'login'}_${nonce}`;
    return { challengeId: id, expiresAt, botUrl: `https://t.me/${TELEGRAM_BOT}?start=${start}` };
  }

  // --------------------------------------------------------------- routes

  private registerRoutes() {
    // Email: code goes to the player's mailbox (here: the in-app inbox).
    this.route('POST', '/v1/auth/email/start', ({ req }) => {
      const email = normalizeEmail((req.body as { email?: unknown })?.email);
      if (!email) return fail(400, 'invalid_input', 'Invalid email');
      const now = this.now();
      const table = this.db.table<ChallengeRow>('challenges');
      const recent = table.values().find((c) => c.kind === 'email' && c.email === email && c.status === 'pending' && (c.sentAt ?? 0) > now - EMAIL_RESEND_MS);
      if (recent) return fail(429, 'rate_limited', 'Wait a little before asking for a new code');
      const id = randomId('ch');
      const code = sixDigits();
      const expiresAt = now + EMAIL_CODE_TTL_MS;
      table.put(id, { id, kind: 'email', email, code, attempts: 0, sentAt: now, expiresAt, status: 'pending' });
      this.deliver({ id: randomId('msg'), ts: now, channel: 'email', to: email, kind: 'login_code', code });
      const res: ChallengeStarted = { challengeId: id, expiresAt };
      return res;
    });

    this.route('POST', '/v1/auth/email/verify', ({ req }) => {
      const body = (req.body ?? {}) as { challengeId?: unknown; code?: unknown };
      if (typeof body.challengeId !== 'string' || typeof body.code !== 'string') return fail(400, 'invalid_input', 'challengeId and code are required');
      const c = this.challenge(body.challengeId);
      if (c.kind !== 'email' || c.status !== 'pending' || c.expiresAt < this.now() || (c.attempts ?? 0) >= EMAIL_MAX_ATTEMPTS) {
        return fail(410, 'challenge_expired', 'The code has expired');
      }
      if (body.code.trim() !== c.code) {
        this.db.table<ChallengeRow>('challenges').put(c.id, { ...c, attempts: (c.attempts ?? 0) + 1 });
        return fail(400, 'invalid_code', 'Wrong code');
      }
      this.db.table<ChallengeRow>('challenges').put(c.id, { ...c, status: 'consumed' });
      return this.signIn({ provider: 'email', subject: c.email!, display: c.email! });
    });

    // Telegram and phone: the app opens the bot; the bot reports back.
    this.route('POST', '/v1/auth/telegram/start', () => this.startBotChallenge('telegram'));
    this.route('POST', '/v1/auth/phone/start', () => this.startBotChallenge('phone'));

    this.route('GET', '/v1/auth/challenges/{id}', ({ params }): ChallengeStatus => {
      const c = this.challenge(params[0]);
      if (c.status === 'confirmed' && c.result) {
        this.db.table<ChallengeRow>('challenges').put(c.id, { ...c, status: 'consumed' });
        return { status: 'confirmed', ...c.result };
      }
      if (c.status === 'consumed' || c.expiresAt < this.now()) return { status: 'expired' };
      return { status: 'pending', expiresAt: c.expiresAt };
    });

    // Google: the server checks the ID token. The stub accepts only its own tokens.
    this.route('POST', '/v1/auth/google', ({ req }) => {
      const token = (req.body as { idToken?: unknown })?.idToken;
      const claims = typeof token === 'string' ? parseMockGoogleToken(token) : null;
      if (!claims) return fail(401, 'unauthorized', 'Google could not confirm this account');
      return this.signIn({ provider: 'google', subject: claims.sub, display: claims.email });
    });

    this.route('POST', '/v1/auth/logout', ({ req }) => {
      if (req.token) this.db.table<SessionRow>('sessions').delete(req.token);
      return { ok: true };
    });

    // Profile.
    this.route('GET', '/v1/me', ({ req }) => {
      const id = this.accountIdFor(req);
      this.settleStale(id);
      return { account: this.account(id), profile: this.profile(id) };
    });

    this.route('PATCH', '/v1/me/profile', ({ req }) => {
      const id = this.accountIdFor(req);
      const patch = (req.body ?? {}) as { nickname?: unknown };
      const p = this.profile(id);
      if (patch.nickname !== undefined) {
        const nickname = typeof patch.nickname === 'string' ? patch.nickname.replace(/\s+/g, ' ').trim() : '';
        if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) return fail(400, 'invalid_input', `Nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters`);
        p.nickname = nickname;
      }
      return this.db.table<Profile>('profiles').put(id, { ...p });
    });

    // Characters and appearance.
    const isCharacter = (v: unknown): v is CharacterId => typeof v === 'string' && (CHARACTER_IDS as readonly string[]).includes(v);
    const isGender = (v: unknown): v is Gender => v === 'm' || v === 'f';

    this.route('POST', '/v1/me/character', ({ req }) => {
      const id = this.accountIdFor(req);
      const body = (req.body ?? {}) as { character?: unknown; gender?: unknown };
      if (!isCharacter(body.character) || !isGender(body.gender)) return fail(400, 'invalid_input', 'Unknown character or gender');
      const p = this.profile(id);
      if (p.character) return fail(409, 'conflict', 'Character already chosen; change it instead');
      if (!p.skins.includes(body.character)) return fail(403, 'forbidden', 'Skin not owned');
      return this.saveProfile({ ...p, character: body.character, gender: body.gender, genderChangedAt: null });
    });

    this.route('POST', '/v1/me/character/change', ({ req }) => {
      const id = this.accountIdFor(req);
      const body = (req.body ?? {}) as { character?: unknown; requestId?: unknown };
      if (!isCharacter(body.character) || typeof body.requestId !== 'string' || !body.requestId) {
        return fail(400, 'invalid_input', 'character and requestId are required');
      }
      const p = this.profile(id);
      if (!p.character) return fail(409, 'conflict', 'Choose a character first');
      if (!p.skins.includes(body.character)) return fail(403, 'forbidden', 'Skin not owned');
      const txId = `charchange:${id}:${body.requestId}`;
      const repeated = this.wallet.has(id, txId);
      if (!repeated && body.character === p.character) return fail(400, 'invalid_input', 'This is already your character');
      // The wallet refuses to go below zero; the same requestId never charges twice.
      const tx = this.wallet.post(id, { id: txId, kind: 'character_change', amount: -CHARACTER_CHANGE_COST, ref: body.character }, this.now());
      const profile = repeated ? p : this.saveProfile({ ...p, character: body.character });
      return { profile, tx };
    });

    this.route('POST', '/v1/me/gender', ({ req }) => {
      const id = this.accountIdFor(req);
      const gender = (req.body as { gender?: unknown })?.gender;
      if (!isGender(gender)) return fail(400, 'invalid_input', 'Unknown gender');
      const p = this.profile(id);
      if (!p.character) return fail(409, 'conflict', 'Choose a character first');
      if (p.gender === gender) return p;
      const now = this.now();
      if (p.genderChangedAt && now - p.genderChangedAt < GENDER_CHANGE_COOLDOWN_MS) {
        return fail(429, 'rate_limited', `Appearance can be changed again at ${p.genderChangedAt + GENDER_CHANGE_COOLDOWN_MS}`);
      }
      return this.saveProfile({ ...p, gender, genderChangedAt: now });
    });

    // Wallet.
    this.route('GET', '/v1/wallet', ({ req }): WalletView => {
      const id = this.accountIdFor(req);
      this.settleStale(id);
      return { currency: 'ABIE', balance: this.wallet.balance(id) };
    });

    this.route('GET', '/v1/wallet/transactions', ({ req, query }) => {
      const id = this.accountIdFor(req);
      return this.wallet.page(id, query.cursor ?? null, Number(query.limit ?? 20));
    });

    // Games and their currencies. There is no route that changes a published game.
    this.route('GET', '/v1/games', ({ req }): GameList => {
      const accountId = this.accountIdFor(req);
      const items = this.db
        .table<GameEntry>('games')
        .values()
        .map(normalizeGame)
        .sort((a, b) => a.publishedAt - b.publishedAt);
      return { items, opened: items.filter((g) => g.entry.kind === 'paid' && this.opened(accountId, g)).map((g) => g.id) };
    });

    // A paid game is opened once: ENTRY_FEE_PERCENT to the platform, the rest to the author.
    this.route('POST', '/v1/games/{id}/entry', ({ req, params }): EntryResult => {
      const accountId = this.accountIdFor(req);
      const game = this.game(params[0]);
      const requestId = (req.body as { requestId?: unknown })?.requestId;
      if (typeof requestId !== 'string' || !requestId) return fail(400, 'invalid_input', 'requestId is required');
      const entries = this.db.table<{ tx: WalletTx | null; at: number }>('entries');
      const key = `${accountId}:${game.id}`;
      const had = entries.get(key);
      if (had) return { game: game.id, tx: had.tx };
      if (game.entry.kind === 'free') return { game: game.id, tx: null };
      const price = game.entry.price;
      const now = this.now();
      const tx = this.wallet.post(accountId, { id: `entry:${game.id}:${accountId}`, kind: 'entry_buy', amount: -price, ref: game.id }, now);
      const fee = game.author ? Math.ceil((price * ENTRY_FEE_PERCENT) / 100) : price;
      this.wallet.post(PLATFORM_ACCOUNT, { id: `entryfee:${game.id}:${accountId}`, kind: 'entry_fee', amount: fee, ref: accountId }, now);
      if (price - fee > 0) {
        this.wallet.post(game.author!.accountId, { id: `entryincome:${game.id}:${accountId}`, kind: 'entry_income', amount: price - fee, ref: game.id }, now);
      }
      entries.put(key, { tx, at: now });
      return { game: game.id, tx };
    });

    this.route('GET', '/v1/games/{id}/currency', ({ req, params }): GameCurrencyBalance => {
      const accountId = this.accountIdFor(req);
      const game = this.game(params[0]);
      if (!game.currency) return fail(404, 'not_found', 'This game has no currency');
      return this.currencyBalance(accountId, game);
    });

    this.route('POST', '/v1/games/{id}/currency/buy', ({ req, params }): CurrencyBuyResult => {
      const accountId = this.accountIdFor(req);
      const game = this.game(params[0]);
      if (!game.currency) return fail(404, 'not_found', 'This game has no currency');
      this.playable(accountId, game);
      const body = (req.body ?? {}) as { lots?: unknown; requestId?: unknown };
      const lots = body.lots;
      if (typeof lots !== 'number' || !Number.isInteger(lots) || lots < 1 || lots > 1000) return fail(400, 'invalid_input', 'lots must be 1-1000');
      if (typeof body.requestId !== 'string' || !body.requestId) return fail(400, 'invalid_input', 'requestId is required');
      const tx = this.buyCurrency(accountId, game, lots, body.requestId);
      return { tx, currency: this.currencyBalance(accountId, game) };
    });

    // Matches.
    this.route('POST', '/v1/matches', ({ req }): MatchStarted => {
      const accountId = this.accountIdFor(req);
      const body = (req.body ?? {}) as { game?: unknown; stakeLots?: unknown; requestId?: unknown };
      const game = this.game(body.game);
      this.playable(accountId, game);
      if (typeof body.requestId !== 'string' || !body.requestId) return fail(400, 'invalid_input', 'requestId is required');
      const requestId = body.requestId;
      const matches = this.db.table<MatchRow>('matches');
      const started = (m: MatchRow): MatchStarted => ({
        matchId: m.id,
        game: m.game,
        seed: m.seed,
        startedAt: m.startedAt,
        stake: m.stake,
        stakeLots: m.stakeLots,
        tx: m.startTx,
      });
      // Same request again (the first answer was lost): the same match.
      const existing = matches.values().find((m) => m.accountId === accountId && m.requestId === requestId);
      if (existing) return started(existing);
      this.settleStale(accountId);

      const id = randomId('m');
      let stake = 0;
      let stakeLots = 0;
      let startTx: WalletTx | null = null;
      if (game.currency) {
        const lots = body.stakeLots;
        if (typeof lots !== 'number' || !Number.isInteger(lots) || lots < 1 || lots > 1000) return fail(400, 'invalid_input', 'stakeLots must be 1-1000');
        const { units } = game.currency.rate;
        stakeLots = lots;
        stake = lots * units;
        const missing = stake - this.currencyLedger(accountId, game.id).balance;
        if (missing > 0) startTx = this.buyCurrency(accountId, game, Math.ceil(missing / units), `match:${requestId}`);
        this.currencyPost(accountId, game.id, { id: `stake:${id}`, kind: 'stake', amount: -stake, ref: id });
      }
      const row: MatchRow = { id, accountId, game: game.id, seed: Math.floor(Math.random() * 0xffffffff) >>> 0, startedAt: this.now(), requestId, stake, stakeLots, startTx };
      matches.put(id, row);
      return started(row);
    });

    this.route('POST', '/v1/matches/{id}/finish', ({ req, params }): MatchFinished => {
      const accountId = this.accountIdFor(req);
      const m = this.db.table<MatchRow>('matches').get(params[0]);
      if (!m || m.accountId !== accountId) return fail(404, 'not_found', 'Unknown match');
      if (m.finished) return m.finished; // repeated request: same answer, nothing paid twice
      const body = (req.body ?? {}) as Partial<MatchFinishRequest>;
      const place = body.place;
      if (typeof place !== 'number' || !Number.isInteger(place) || place < 1 || place > 4) return fail(400, 'invalid_input', 'Place must be 1-4');
      const equity = body.equity;
      if (typeof equity !== 'number' || !Number.isInteger(equity) || equity < 0 || equity > m.stake * MAX_EQUITY_MULTIPLE) {
        return fail(400, 'invalid_input', 'equity must be a whole number from 0');
      }
      return this.settle(m, place, equity, false);
    });
  }

  // --------------------------------------------------- the outside world

  private deliver(msg: InboxMessage) {
    this.devDb.table<InboxMessage>('inbox').put(msg.id, msg);
    for (const fn of this.inboxListeners) fn(msg);
  }

  readonly dev = {
    /** Messages sent to players (newest first). */
    inbox: async (): Promise<InboxMessage[]> => {
      await this.openAll();
      return this.devDb
        .table<InboxMessage>('inbox')
        .values()
        .sort((a, b) => b.ts - a.ts);
    },
    onInbox: (fn: (m: InboxMessage) => void): (() => void) => {
      this.inboxListeners.add(fn);
      return () => {
        this.inboxListeners.delete(fn);
      };
    },
    /**
     * What the Telegram bot reports after the player pressed the button:
     * their Telegram id and username, and for the phone flow the shared number.
     */
    telegramConfirm: async (botUrl: string, user: { id: number; username: string; phone?: string }) => {
      await this.openAll();
      const start = botUrl.split('start=')[1] ?? '';
      const nonce = start.replace(/^(login|phone)_/, '');
      const table = this.db.table<ChallengeRow>('challenges');
      const c = table.values().find((x) => x.nonce === nonce);
      if (!c || c.status !== 'pending' || c.expiresAt < this.now()) throw new ServerError(410, 'challenge_expired', 'Sign-in link expired');
      let identity: Identity;
      if (c.kind === 'phone') {
        const phone = normalizePhone(user.phone);
        if (!phone) throw new ServerError(400, 'invalid_input', 'Invalid phone number');
        identity = { provider: 'phone', subject: phone, display: maskPhone(phone) };
      } else {
        identity = { provider: 'telegram', subject: String(user.id), display: `@${user.username}` };
      }
      table.put(c.id, { ...c, status: 'confirmed', result: this.signIn(identity) });
      await this.db.flush();
    },
    /** Erases everything the server stores, including wallets. */
    reset: async () => {
      await this.openAll();
      await Promise.all([this.db.wipe(), this.devDb.wipe(), this.wallet.wipe()]);
    },
    walletAudit: async () => {
      await this.openAll();
      return this.wallet.audit();
    },
    /**
     * Publishes a game on the platform. Allowed once per game id: after that
     * the entry, its universes and its currency rate never change.
     */
    /** Every proposal on the server, newest first (the moderator's view). */
    proposals: async (): Promise<Proposal[]> => {
      await this.openAll();
      return this.db
        .table<Proposal>('proposals')
        .values()
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    /** The moderator's answer to a proposal; 'approved' publishes the game. */
    moderate: async (id: string, status: Exclude<ProposalStatus, 'review'>, message?: string): Promise<Proposal> => {
      await this.openAll();
      const p = moderate(this, id, status, message);
      await this.db.flush();
      return p;
    },
    publishGame: async (entry: GameEntry) => {
      await this.openAll();
      this.publish(entry);
      await this.db.flush();
    },
  };
}

// ------------------------------------------------------- Google stand-in

export function makeMockGoogleToken(claims: { sub: string; email: string; name: string }): string {
  return 'mock-google.' + encodeURIComponent(JSON.stringify(claims));
}

function parseMockGoogleToken(token: string): { sub: string; email: string; name: string } | null {
  if (!token.startsWith('mock-google.')) return null;
  try {
    const c = JSON.parse(decodeURIComponent(token.slice('mock-google.'.length)));
    return typeof c.sub === 'string' && typeof c.email === 'string' ? c : null;
  } catch {
    return null;
  }
}

export type { AuthProvider };
