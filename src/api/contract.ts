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

export type TxKind = 'welcome' | 'match_reward' | 'character_change';

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

// ------------------------------------------------------------------ matches

export type GameId = 'duel';

/** POST /v1/matches: the server opens a match and picks the seed. */
export interface MatchStartRequest {
  game: GameId;
}
export interface MatchStarted {
  matchId: string;
  game: GameId;
  seed: number;
  startedAt: number;
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
 * Today the server trusts `place`. In the next step it replays `actions`
 * with the match seed and computes the place itself.
 */
export interface MatchFinishRequest {
  place: number;
  actions: MatchAction[];
}
export interface MatchFinished {
  matchId: string;
  place: number;
  reward: number;
  tx: WalletTx | null;
  profile: Profile;
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
