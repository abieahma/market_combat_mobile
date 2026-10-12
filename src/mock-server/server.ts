// Server stub: answers the routes of src/api/contract.ts the way the future
// Go server will. It runs inside the app and keeps its own data, separate
// from the app's cache. The parts that stand in for the outside world
// (email delivery, the Telegram bot, Google) are under `dev`.

import {
  CHARACTER_CHANGE_COST,
  CHARACTER_IDS,
  CharacterId,
  FREE_SKINS,
  Gender,
  GENDER_CHANGE_COOLDOWN_MS,
  NICKNAME_MAX,
  NICKNAME_MIN,
} from '../api/contract';
import type {
  Account,
  AuthProvider,
  AuthResult,
  ChallengeStarted,
  ChallengeStatus,
  ErrorCode,
  Identity,
  MatchFinished,
  MatchFinishRequest,
  MatchStarted,
  Profile,
  WalletView,
} from '../api/contract';
import type { ApiRequest, ApiResponse } from '../api/transport';
import { rewardForPlace } from '../game/duel';
import { WELCOME_BONUS } from '../wallet/ledger';
import { Database, KeyValue } from './db';
import { WalletError, WalletService } from './wallet-service';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_RESEND_MS = 30 * 1000;
export const EMAIL_MAX_ATTEMPTS = 5;
export const BOT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const TELEGRAM_BOT = 'MarketCombatBot';

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
  game: 'duel';
  seed: number;
  startedAt: number;
  finished?: MatchFinished;
}

/** Messages "delivered" to the player outside the game. */
export interface InboxMessage {
  id: string;
  ts: number;
  channel: 'email';
  to: string;
  kind: 'login_code';
  code: string;
}

export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const fail = (status: number, code: ErrorCode, message: string): never => {
  throw new ServerError(status, code, message);
};

function randomId(prefix: string, length = 16): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${s}`;
}

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
  private readonly db: Database;
  private readonly devDb: Database;
  readonly wallet: WalletService;
  private readonly routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
  private readonly inboxListeners = new Set<(m: InboxMessage) => void>();
  now: () => number = () => Date.now();

  constructor(kv: KeyValue) {
    this.db = new Database(kv, 'game', ['accounts', 'identities', 'sessions', 'profiles', 'challenges', 'matches']);
    this.devDb = new Database(kv, 'outside', ['inbox']);
    this.wallet = new WalletService(kv);
    this.registerRoutes();
  }

  // ------------------------------------------------------------ plumbing

  private route(method: string, path: string, handler: Handler) {
    const pattern = new RegExp('^' + path.replace(/\{[^}]+\}/g, '([^/]+)') + '$');
    this.routes.push({ method, pattern, handler });
  }

  private async openAll() {
    await Promise.all([this.db.open(), this.devDb.open(), this.wallet.open()]);
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

  private accountIdFor(req: ApiRequest): string {
    if (!req.token) return fail(401, 'unauthorized', 'Sign in first');
    const s = this.db.table<SessionRow>('sessions').get(req.token);
    if (!s || s.expiresAt < this.now()) return fail(401, 'unauthorized', 'Session expired, sign in again');
    return s.accountId;
  }

  // ------------------------------------------------------------- accounts

  private profile(accountId: string): Profile {
    const p = this.db.table<Profile>('profiles').get(accountId);
    if (!p) return fail(404, 'not_found', 'No profile');
    // Profiles saved before skins existed own the free ones.
    return Array.isArray(p.skins) ? p : { ...p, skins: [...FREE_SKINS] };
  }

  private saveProfile(p: Profile): Profile {
    return this.db.table<Profile>('profiles').put(p.accountId, { ...p });
  }

  private account(accountId: string): Account {
    const a = this.db.table<AccountRow>('accounts').get(accountId);
    return a ?? fail(404, 'not_found', 'No account');
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
      return { currency: 'ABIE', balance: this.wallet.balance(id) };
    });

    this.route('GET', '/v1/wallet/transactions', ({ req, query }) => {
      const id = this.accountIdFor(req);
      return this.wallet.page(id, query.cursor ?? null, Number(query.limit ?? 20));
    });

    // Matches.
    this.route('POST', '/v1/matches', ({ req }): MatchStarted => {
      const accountId = this.accountIdFor(req);
      const game = (req.body as { game?: unknown })?.game;
      if (game !== 'duel') return fail(400, 'invalid_input', 'Unknown game');
      const id = randomId('m');
      const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
      const startedAt = this.now();
      this.db.table<MatchRow>('matches').put(id, { id, accountId, game, seed, startedAt });
      return { matchId: id, game, seed, startedAt };
    });

    this.route('POST', '/v1/matches/{id}/finish', ({ req, params }): MatchFinished => {
      const accountId = this.accountIdFor(req);
      const m = this.db.table<MatchRow>('matches').get(params[0]);
      if (!m || m.accountId !== accountId) return fail(404, 'not_found', 'Unknown match');
      if (m.finished) return m.finished; // repeated request: same answer, no second reward
      const body = (req.body ?? {}) as Partial<MatchFinishRequest>;
      const place = body.place;
      if (typeof place !== 'number' || !Number.isInteger(place) || place < 1 || place > 4) return fail(400, 'invalid_input', 'Place must be 1-4');
      const reward = rewardForPlace(place);
      const tx = reward > 0 ? this.wallet.post(accountId, { id: `match:${m.id}`, kind: 'match_reward', amount: reward, ref: m.id }, this.now()) : null;
      const p = this.profile(accountId);
      const profile = this.db.table<Profile>('profiles').put(accountId, {
        ...p,
        stats: { matches: p.stats.matches + 1, wins: p.stats.wins + (place === 1 ? 1 : 0), earned: p.stats.earned + reward },
      });
      const finished: MatchFinished = { matchId: m.id, place, reward, tx, profile };
      this.db.table<MatchRow>('matches').put(m.id, { ...m, finished });
      return finished;
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
