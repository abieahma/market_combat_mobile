// Typed API client. Screens call these methods and never see the transport.

import type {
  AbieQuote,
  AbieQuoteRequest,
  ApiErrorBody,
  AuthResult,
  ChangeCharacterResult,
  CharacterId,
  ChallengeStarted,
  ChallengeStatus,
  CountryCode,
  CurrencyBuyResult,
  EntryResult,
  ErrorCode,
  KombatBoost,
  KombatBoostPackId,
  KombatMode,
  KombatMove,
  KombatView,
  Offer,
  Proposal,
  ProposalDraft,
  GameCurrencyBalance,
  GameId,
  GameList,
  Gender,
  MatchFinishRequest,
  MatchFinished,
  MatchStarted,
  MatchStartRequest,
  MeResponse,
  Profile,
  ProfilePatch,
  TxPage,
  WalletTx,
  WalletView,
} from './contract';
import { ApiError, ApiRequest, Method, Transport } from './transport';

export interface ApiClient {
  setToken(token: string | null): void;
  /** Region of the device, sent with every request as a weak hint for the country of a new cabinet. */
  setRegion(region: string | null): void;
  auth: {
    emailStart(email: string): Promise<ChallengeStarted>;
    emailVerify(challengeId: string, code: string): Promise<AuthResult>;
    telegramStart(): Promise<ChallengeStarted>;
    phoneStart(): Promise<ChallengeStarted>;
    challenge(challengeId: string): Promise<ChallengeStatus>;
    google(idToken: string): Promise<AuthResult>;
    logout(): Promise<void>;
  };
  me: {
    get(): Promise<MeResponse>;
    patch(patch: ProfilePatch): Promise<Profile>;
    chooseCharacter(character: CharacterId, gender: Gender): Promise<Profile>;
    changeCharacter(character: CharacterId, requestId: string): Promise<ChangeCharacterResult>;
    changeGender(gender: Gender): Promise<Profile>;
    /** Out to the neutral cabinet, free. */
    leaveUniverse(): Promise<Profile>;
    /** Back into one's universe for UNIVERSE_RETURN_COST ABIE. */
    returnUniverse(requestId: string): Promise<ChangeCharacterResult>;
  };
  wallet: {
    get(): Promise<WalletView>;
    transactions(cursor?: string | null, limit?: number): Promise<TxPage>;
    /** Price of ABIE in the money of the cabinet's country. */
    quote(req: AbieQuoteRequest): Promise<AbieQuote & { home: CountryCode }>;
  };
  games: {
    list(): Promise<GameList>;
    currency(game: GameId): Promise<GameCurrencyBalance>;
    buyCurrency(game: GameId, lots: number, requestId: string): Promise<CurrencyBuyResult>;
    /** Pays the entry of a paid game once. */
    payEntry(game: GameId, requestId: string): Promise<EntryResult>;
  };
  proposals: {
    offer(lang: string): Promise<Offer>;
    create(draft: ProposalDraft, offerVersion: string, requestId: string): Promise<Proposal>;
    list(): Promise<{ items: Proposal[] }>;
    get(id: string): Promise<Proposal>;
    message(id: string, text: string): Promise<Proposal>;
    update(id: string, draft: ProposalDraft): Promise<Proposal>;
  };
  kombat: {
    start(mode: KombatMode, stakeLots: number | undefined, requestId: string): Promise<KombatView>;
    get(id: string): Promise<KombatView>;
    move(id: string, turn: number, move: KombatMove): Promise<KombatView>;
    leave(id: string): Promise<KombatView>;
    boost(): Promise<KombatBoost>;
    buyBoost(pack: KombatBoostPackId, requestId: string): Promise<{ tx: WalletTx; boost: KombatBoost }>;
  };
  matches: {
    start(req: MatchStartRequest): Promise<MatchStarted>;
    finish(matchId: string, req: MatchFinishRequest): Promise<MatchFinished>;
  };
}

export function createApi(transport: Transport): ApiClient {
  let token: string | null = null;
  let region: string | null = null;

  async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const req: ApiRequest = { method, path, body, token, region };
    const res = await transport.send(req);
    if (res.status >= 200 && res.status < 300) return res.body as T;
    const err = (res.body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, (err?.code ?? 'internal') as ErrorCode, err?.message ?? `HTTP ${res.status}`);
  }

  return {
    setToken(next) {
      token = next;
    },
    setRegion(next) {
      region = next;
    },
    auth: {
      emailStart: (email) => call('POST', '/v1/auth/email/start', { email }),
      emailVerify: (challengeId, code) => call('POST', '/v1/auth/email/verify', { challengeId, code }),
      telegramStart: () => call('POST', '/v1/auth/telegram/start', {}),
      phoneStart: () => call('POST', '/v1/auth/phone/start', {}),
      challenge: (id) => call('GET', `/v1/auth/challenges/${encodeURIComponent(id)}`),
      google: (idToken) => call('POST', '/v1/auth/google', { idToken }),
      logout: async () => {
        await call('POST', '/v1/auth/logout', {});
      },
    },
    me: {
      get: () => call('GET', '/v1/me'),
      patch: (patch) => call('PATCH', '/v1/me/profile', patch),
      chooseCharacter: (character, gender) => call('POST', '/v1/me/character', { character, gender }),
      changeCharacter: (character, requestId) => call('POST', '/v1/me/character/change', { character, requestId }),
      changeGender: (gender) => call('POST', '/v1/me/gender', { gender }),
      leaveUniverse: () => call('POST', '/v1/me/universe/leave'),
      returnUniverse: (requestId) => call('POST', '/v1/me/universe/return', { requestId }),
    },
    wallet: {
      get: () => call('GET', '/v1/wallet'),
      transactions: (cursor, limit = 20) => {
        // Built by hand: URLSearchParams is incomplete in React Native.
        let q = `limit=${limit}`;
        if (cursor) q += `&cursor=${encodeURIComponent(cursor)}`;
        return call('GET', `/v1/wallet/transactions?${q}`);
      },
      quote: (req) => call('POST', '/v1/abie/quote', req),
    },
    games: {
      list: () => call('GET', '/v1/games'),
      currency: (game) => call('GET', `/v1/games/${encodeURIComponent(game)}/currency`),
      buyCurrency: (game, lots, requestId) => call('POST', `/v1/games/${encodeURIComponent(game)}/currency/buy`, { lots, requestId }),
      payEntry: (game, requestId) => call('POST', `/v1/games/${encodeURIComponent(game)}/entry`, { requestId }),
    },
    proposals: {
      offer: (lang) => call('GET', `/v1/offer?lang=${encodeURIComponent(lang)}`),
      create: (draft, offerVersion, requestId) => call('POST', '/v1/proposals', { ...draft, offerVersion, requestId }),
      list: () => call('GET', '/v1/proposals'),
      get: (id) => call('GET', `/v1/proposals/${encodeURIComponent(id)}`),
      message: (id, text) => call('POST', `/v1/proposals/${encodeURIComponent(id)}/messages`, { text }),
      update: (id, draft) => call('PUT', `/v1/proposals/${encodeURIComponent(id)}`, draft),
    },
    kombat: {
      start: (mode, stakeLots, requestId) => call('POST', '/v1/kombat/fights', { mode, stakeLots, requestId }),
      get: (id) => call('GET', `/v1/kombat/fights/${encodeURIComponent(id)}`),
      move: (id, turn, move) => call('POST', `/v1/kombat/fights/${encodeURIComponent(id)}/move`, { turn, move }),
      leave: (id) => call('POST', `/v1/kombat/fights/${encodeURIComponent(id)}/leave`),
      boost: () => call('GET', '/v1/kombat/boost'),
      buyBoost: (pack, requestId) => call('POST', '/v1/kombat/boost', { pack, requestId }),
    },
    matches: {
      start: (req) => call('POST', '/v1/matches', req),
      finish: (matchId, req) => call('POST', `/v1/matches/${encodeURIComponent(matchId)}/finish`, req),
    },
  };
}
