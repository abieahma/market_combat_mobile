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

export const CHARACTER_IDS = ['waldberik', 'ozonik', 'avitos', 'yandos'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];
/** Ids used before a rename; data saved with them is read as the new id. */
export const OLD_CHARACTER_IDS: Record<string, CharacterId> = { valdberik: 'waldberik' };

/** The current id for a character id read from stored data. */
export function currentCharacterId(id: string | null | undefined): CharacterId | null {
  if (!id) return null;
  if ((CHARACTER_IDS as readonly string[]).includes(id)) return id as CharacterId;
  return OLD_CHARACTER_IDS[id] ?? null;
}
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
  | 'payment_required'
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
 * - entry_buy: a paid game opened by the player; entry_fee: the platform's 10%
 *   of it; entry_income: the rest, paid to the game's author
 * - author_share: the author's share of a currency purchase in their game
 * - kombat_boost: a pack of energy boosts for Market Kombat
 */
export type TxKind =
  | 'welcome'
  | 'match_reward'
  | 'character_change'
  | 'currency_buy'
  | 'currency_return'
  | 'currency_sale'
  | 'currency_payout'
  | 'entry_buy'
  | 'entry_fee'
  | 'entry_income'
  | 'author_share'
  | 'kombat_boost';

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
/** Share of each paid game entry the platform keeps; the rest goes to the game's author. */
export const ENTRY_FEE_PERCENT = 10;

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

/** How a player gets into a game: free, or a one-time payment in ABIE that opens it for good. */
export type GameEntryFee = { kind: 'free' } | { kind: 'paid'; price: number };

/**
 * A game on the platform. Everything here is set when the game is published
 * and is never changed afterwards; there is no route to change it.
 */
export interface GameEntry {
  id: GameId;
  /** Title of a game proposed by an author; the platform's own games are named in the app. */
  title?: string;
  /** Universes (characters) the game appears in; 'all' means a common game. */
  universes: CharacterId[] | 'all';
  /** The game's own currency, bought only with ABIE; null if it has none. */
  currency: GameCurrency | null;
  entry: GameEntryFee;
  /** Author of the idea; null for the platform's own games. */
  author: { accountId: string; nickname: string } | null;
  /** Percent of every currency purchase in this game paid to the author. */
  authorShare: number;
  publishedAt: number;
}

/** GET /v1/games */
export interface GameList {
  items: GameEntry[];
  /** Paid games this player has already opened. */
  opened: GameId[];
}

/**
 * POST /v1/games/{id}/entry: pays the entry of a paid game once; the game
 * stays open for the player. ENTRY_FEE_PERCENT goes to the platform, the
 * rest to the author. Same requestId (or a game already open) = nothing
 * charged again. Playing a paid game before that: 402 payment_required.
 */
export interface EntryRequest {
  requestId: string;
}
export interface EntryResult {
  game: GameId;
  tx: WalletTx | null;
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

// ----------------------------------------------------- game proposals

/**
 * Authors send ideas, not code: the platform builds approved games itself.
 * A proposal goes through moderation and, once approved, becomes a game in
 * the registry with the universes, currency, entry and author share it was
 * approved with. Those never change afterwards.
 */
export type ProposalStatus = 'review' | 'changes_requested' | 'approved' | 'rejected';

export interface ProposalDraft {
  title: string;
  description: string;
  universes: CharacterId[] | 'all';
  /** Own currency of the game; it can only be bought with ABIE and does not go back. */
  currency: { code: string; rate: CurrencyRate; authorShare: number } | null;
  entry: GameEntryFee;
}

export interface ProposalMessage {
  id: string;
  ts: number;
  from: 'author' | 'moderator';
  text: string;
}

export interface Proposal extends ProposalDraft {
  id: string;
  authorId: string;
  status: ProposalStatus;
  /** Version of the offer the author accepted. */
  offerVersion: string;
  createdAt: number;
  updatedAt: number;
  messages: ProposalMessage[];
  /** Set when approved: the game it became. */
  gameId?: GameId;
}

export const PROPOSAL_TITLE_MIN = 3;
export const PROPOSAL_TITLE_MAX = 60;
export const PROPOSAL_DESCRIPTION_MIN = 20;
export const PROPOSAL_DESCRIPTION_MAX = 2000;

/**
 * GET  /v1/offer?lang=ru                → Offer (the terms an author accepts)
 * POST /v1/proposals { ...ProposalDraft, offerVersion, requestId } → Proposal
 *      409 conflict if offerVersion is not the current one.
 * GET  /v1/proposals                    → { items: Proposal[] }  (the player's own, newest first)
 * GET  /v1/proposals/{id}               → Proposal
 * POST /v1/proposals/{id}/messages { text }   → Proposal
 * PUT  /v1/proposals/{id} { ...ProposalDraft } → Proposal  (only when changes were requested; goes back to review)
 * Moderation (moderators only; in the stub it is server.dev.moderate):
 * POST /v1/moderation/proposals/{id} { status, message? } → Proposal; 'approved' publishes the game.
 */
export interface ProposalCreateRequest extends ProposalDraft {
  offerVersion: string;
  requestId: string;
}

export interface Offer {
  version: string;
  /** True while the text is a draft waiting for a lawyer. */
  draft: boolean;
  title: string;
  paragraphs: string[];
}

// ------------------------------------------------------- Market Kombat

/**
 * Turn-based fights between the characters of the universes. Both players
 * choose a move within the turn timer without seeing the other's choice;
 * when both have chosen (or the timer runs out) the server plays the turn
 * out and both see what happened. Rules: src/game/kombat.ts.
 *
 * - pvp: equal stakes in fight chips (bought with ABIE); the winner takes
 *   both, the platform keeps PLATFORM_FEE_PERCENT of the win; a draw returns
 *   the stakes. Chips go back to ABIE after the fight.
 * - bot: training only: no stakes, nothing to win.
 */
export type KombatMode = 'bot' | 'pvp';
export type KombatMove = 'strike' | 'special' | 'block' | 'charge';
export type KombatStatus = 'waiting' | 'active' | 'finished' | 'cancelled';

export interface KombatFighterView {
  nickname: string;
  character: CharacterId;
  gender: Gender;
  isBot: boolean;
  hp: number;
  energy: number;
  combo: number;
  boosted: boolean;
}

export interface KombatTurnView {
  turn: number;
  moves: [KombatMove, KombatMove];
  /** Damage each fighter took this turn. */
  damage: [number, number];
  crit: [boolean, boolean];
  /** Health the special move gave back, energy it took from the other. */
  healed: [number, number];
  drained: [number, number];
}

export interface KombatSettlement {
  /** Index of the winner in `fighters`, null for a draw. */
  winner: 0 | 1 | null;
  reason: 'ko' | 'turns' | 'forfeit';
  /** Fight chips: the stake and what came back to this player. */
  stake: number;
  back: number;
  fee: number;
  /** ABIE back to the wallet and the result against the ABIE staked. */
  payout: number;
  net: number;
  tx: WalletTx | null;
}

export interface KombatView {
  id: string;
  mode: KombatMode;
  status: KombatStatus;
  /** This player's index in `fighters`. */
  you: 0 | 1;
  /** The second fighter is null while waiting for an opponent. */
  fighters: [KombatFighterView, KombatFighterView | null];
  turn: number;
  maxTurns: number;
  turnMs: number;
  /** When the current turn is played out; null outside an active fight. */
  deadline: number | null;
  serverNow: number;
  /** This player's move for the current turn; the opponent's is never shown before the turn is played. */
  myMove: KombatMove | null;
  last: KombatTurnView | null;
  stake: number;
  stakeLots: number;
  settlement: KombatSettlement | null;
}

/** POST /v1/kombat/fights */
export interface KombatStartRequest {
  mode: KombatMode;
  /** pvp only: whole lots of the fight currency rate. */
  stakeLots?: number;
  requestId: string;
}
/** POST /v1/kombat/fights/{id}/move */
export interface KombatMoveRequest {
  turn: number;
  move: KombatMove;
}

/** Energy boost: energy comes back twice as fast, for a paid number of pvp fights. Very expensive on purpose. */
export const KOMBAT_BOOST_PACKS = [
  { id: 'boost1', fights: 1, price: 500 },
  { id: 'boost5', fights: 5, price: 2000 },
] as const;
export type KombatBoostPackId = (typeof KOMBAT_BOOST_PACKS)[number]['id'];
/** GET /v1/kombat/boost → KombatBoost; POST /v1/kombat/boost { pack, requestId } → { tx, boost } */
export interface KombatBoost {
  fightsLeft: number;
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
