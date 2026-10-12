// Market Combat API contract.
//
// This is the agreement between the app and the server. Today the server is
// a stub inside the app (src/mock-server); later the same routes will be
// served by the Go server at https://api.ahilespelid.ru. The app only talks
// to the server through these types, so swapping the server does not touch
// the screens. Human-readable version: docs/api.md.
//
// Conventions: JSON over HTTPS, `Authorization: Bearer <token>`, amounts in
// whole ABIE, times in Unix milliseconds, errors as { error: { code, message } }.

// ------------------------------------------------------------------ common

export const CHARACTER_IDS = ['valdberik', 'ozonik', 'avitos', 'yandos'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
export type Gender = 'm' | 'f';
/** A skin the player owns. The 4 base skins are the free characters. */
export type SkinId = string;
export const FREE_SKINS: SkinId[] = [...CHARACTER_IDS];
/** Changing character keeps ratings, history and ABIE, but costs this much. */
export const CHARACTER_CHANGE_COST = 5000;
/** Appearance (gender) can be changed for free, once per this period. */
export const GENDER_CHANGE_COOLDOWN_MS = 7 * 24 * 3600 * 1000;
export type AuthProvider = 'google' | 'telegram' | 'phone' | 'email';

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_input'
  | 'invalid_code'
  | 'challenge_expired'
  | 'insufficient_funds'
  | 'rate_limited'
  | 'conflict'
  | 'network'
  | 'internal';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

export interface Identity {
  provider: AuthProvider;
  /** Stable id at the provider: Google sub, Telegram user id, phone in E.164, email. */
  subject: string;
  /** What to show the player: an address, @username or a masked phone. */
  display: string;
}

export interface Account {
  id: string;
  createdAt: number;
  identities: Identity[];
}

export interface Profile {
  accountId: string;
  nickname: string;
  character: CharacterId | null;
  gender: Gender | null;
  genderChangedAt: number | null;
  /** Skins the player owns. */
  skins: SkinId[];
  /** `earned`: net ABIE result of all matches (what came back minus stakes); can be negative. */
  stats: { matches: number; wins: number; earned: number };
  respect: { points: number; level: number };
}

export interface Session {
  token: string;
  expiresAt: number;
}

export interface AuthResult {
  session: Session;
  account: Account;
  profile: Profile;
  /** True when this sign-in created the account. */
  isNew: boolean;
}

// -------------------------------------------------------------------- auth

/** POST /v1/auth/email/start: send a 6-digit code to the address. */
export interface EmailStartRequest {
  email: string;
}
export interface ChallengeStarted {
  challengeId: string;
  expiresAt: number;
  /** Telegram flows: link that opens the bot with a one-time start parameter. */
  botUrl?: string;
}

/** POST /v1/auth/email/verify */
export interface EmailVerifyRequest {
  challengeId: string;
  code: string;
}

/**
 * POST /v1/auth/telegram/start: sign in with a Telegram account.
 * POST /v1/auth/phone/start: sign in with a phone number; the bot asks the
 * player to share the number of their Telegram account (free, no SMS).
 * Both return a challenge; the app opens `botUrl` and polls the status.
 */
export type TelegramStartRequest = Record<string, never>;

/** GET /v1/auth/challenges/{challengeId} */
export type ChallengeStatus =
  | { status: 'pending'; expiresAt: number }
  | { status: 'expired' }
  | ({ status: 'confirmed' } & AuthResult);

/** POST /v1/auth/google: the server verifies a Google ID token. */
export interface GoogleSignInRequest {
  idToken: string;
}

/** POST /v1/auth/logout: ends the current session. Response: { ok: true }. */

// ----------------------------------------------------------------- profile

/** GET /v1/me */
export interface MeResponse {
  account: Account;
  profile: Profile;
}

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

/** PATCH /v1/me/profile */
export interface ProfilePatch {
  nickname?: string;
}

// -------------------------------------------------------------- characters

/** POST /v1/me/character: first choice, free. Response: Profile. 409 if already chosen. */
export interface ChooseCharacterRequest {
  character: CharacterId;
  gender: Gender;
}

/**
 * POST /v1/me/character/change: costs CHARACTER_CHANGE_COST ABIE, keeps
 * progress. 409 insufficient_funds when the balance is too low.
 */
export interface ChangeCharacterRequest {
  character: CharacterId;
  /** Client-generated id; repeating it does not charge twice. */
  requestId: string;
}
export interface ChangeCharacterResult {
  profile: Profile;
  tx: WalletTx;
}

/**
 * POST /v1/me/gender: free, once per GENDER_CHANGE_COOLDOWN_MS.
 * Response: Profile. 429 rate_limited before the period is over.
 */
export interface ChangeGenderRequest {
  gender: Gender;
}

// ------------------------------------------------------------ ABIE wallet

/**
 * - welcome: bonus for a new account
 * - match_reward: prize for a place (old matches; prizes are gone)
 * - character_change: paid character change
 * - currency_buy: ABIE paid for a game currency (player side)
 * - currency_return: game currency turned back into ABIE after a match (player side)
 * - currency_sale / currency_payout: the same two, seen from the platform account
 */
export type TxKind =
  | 'welcome'
  | 'match_reward'
  | 'character_change'
  | 'currency_buy'
  | 'currency_return'
  | 'currency_sale'
  | 'currency_payout';

export interface WalletTx {
  /** Unique operation id; posting the same id again changes nothing. */
  id: string;
  ts: number;
  kind: TxKind;
  /** Positive for credits, negative for debits. */
  amount: number;
  balanceAfter: number;
  /** What the operation is about: match id, character id, … */
  ref?: string;
}

/** GET /v1/wallet */
export interface WalletView {
  currency: 'ABIE';
  balance: number;
}

/** GET /v1/wallet/transactions?cursor=&limit= (newest first) */
export interface TxPage {
  items: WalletTx[];
  nextCursor: string | null;
}

// -------------------------------------------------------------------- games

/** Any game published on the platform; the app knows how to show the ones in src/games.ts. */
export type GameId = string;

/** Account that receives the ABIE paid for game currencies and pays back what returns from matches. */
export const PLATFORM_ACCOUNT = 'platform';
/** Share of a player's profit the platform keeps when a game currency goes back to ABIE. */
export const PLATFORM_FEE_PERCENT = 10;

/** `abie` ABIE buy `units` of the game currency. Whole numbers only. */
export interface CurrencyRate {
  abie: number;
  units: number;
}

export interface GameCurrency {
  /** Short code, e.g. DUSD for Chart Duel dollars. */
  code: string;
  /** Set once when the game is published on the platform and never changed. */
  rate: CurrencyRate;
  /**
   * What happens to the currency after a match:
   * - 'match': everything the match returns goes back to ABIE at the same rate;
   *   the platform keeps PLATFORM_FEE_PERCENT of the profit, nothing of a loss.
   * - 'none': it stays in the game. A general way back to ABIE does not exist
   *   yet; it will be decided later.
   */
  settle: 'match' | 'none';
}

/**
 * A game on the platform. Everything here is set when the game is published
 * and is never changed afterwards; there is no route to change it.
 */
export interface GameEntry {
  id: GameId;
  /** Universes (characters) the game appears in; 'all' means a common game. */
  universes: CharacterId[] | 'all';
  /** The game's own currency, bought only with ABIE; null if it has none. */
  currency: GameCurrency | null;
  publishedAt: number;
}

/** GET /v1/games */
export interface GameList {
  items: GameEntry[];
}

/** GET /v1/games/{id}/currency: the player's balance in the game currency. */
export interface GameCurrencyBalance {
  game: GameId;
  code: string;
  balance: number;
}

/**
 * POST /v1/games/{id}/currency/buy: buys `lots` × rate.units for
 * `lots` × rate.abie ABIE. The ABIE go to PLATFORM_ACCOUNT. Repeating the same
 * requestId returns the first result and charges nothing more.
 * 409 insufficient_funds when the ABIE balance is too low.
 */
export interface CurrencyBuyRequest {
  lots: number;
  requestId: string;
}
export interface CurrencyBuyResult {
  tx: WalletTx;
  currency: GameCurrencyBalance;
}

// ------------------------------------------------------------------ matches

/**
 * POST /v1/matches: the server opens a match and picks the seed.
 * Games with a currency need a stake: `stakeLots` whole lots of the rate.
 * Whatever the player lacks in the game currency is bought from ABIE in the
 * same operation. The same requestId returns the same match.
 * 403 if the game is not in the player's universe, 409 conflict if no
 * character is chosen yet, 409 insufficient_funds if ABIE are short.
 */
export interface MatchStartRequest {
  game: GameId;
  stakeLots?: number;
  requestId: string;
}
export interface MatchStarted {
  matchId: string;
  game: GameId;
  seed: number;
  startedAt: number;
  /** Stake in the game currency; every trader starts the match with it. */
  stake: number;
  stakeLots: number;
  /** The ABIE purchase made for the stake, if one was needed. */
  tx: WalletTx | null;
}

/** One player action during a match, by match tick. */
export interface MatchAction {
  tick: number;
  type: 'open' | 'close';
  side?: 1 | -1;
  leverage?: number;
}

/**
 * POST /v1/matches/{matchId}/finish
 * Today the server trusts `place` and `equity`. In the next step it replays
 * `actions` with the match seed and computes both itself.
 * A match not finished in time is settled by the server as a refund of the stake.
 */
export interface MatchFinishRequest {
  place: number;
  /** Player's balance in the game currency at the end, whole units. */
  equity: number;
  actions: MatchAction[];
}
export interface MatchFinished {
  matchId: string;
  place: number;
  /** In the game currency. */
  stake: number;
  equity: number;
  /** equity − stake. */
  profit: number;
  /** Kept by the platform: PLATFORM_FEE_PERCENT of a profit, rounded up; 0 for a loss. */
  fee: number;
  /** ABIE returned to the wallet: (equity − fee) at the rate, rounded to whole ABIE. */
  payout: number;
  /** payout − ABIE paid for the stake. */
  net: number;
  tx: WalletTx | null;
  profile: Profile;
  /** True when the server closed the match because it was never finished. */
  abandoned?: boolean;
}

// ------------------------------------------------------- help (later step)

export type HelpKind = 'hint' | 'partner' | 'shield';

export interface HelpRequest {
  id: string;
  fromAccountId: string;
  fromNickname: string;
  world: CharacterId;
  kind: HelpKind;
  createdAt: number;
  status: 'open' | 'answered' | 'expired';
  answeredBy?: { accountId: string; nickname: string };
}

/**
 * POST /v1/help/requests            { kind } → HelpRequest   (female characters only)
 * GET  /v1/help/requests?box=incoming|mine  → HelpRequest[] (incoming: male players of the same world)
 * POST /v1/help/requests/{id}/answer         → HelpRequest   (helper gets respect)
 * GET  /v1/respect                           → Profile['respect']
 */
export interface CreateHelpRequest {
  kind: HelpKind;
}
