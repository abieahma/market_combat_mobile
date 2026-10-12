// Typed API client. Screens call these methods and never see the transport.

import type {
  ApiErrorBody,
  AuthResult,
  ChangeCharacterResult,
  CharacterId,
  ChallengeStarted,
  ChallengeStatus,
  ErrorCode,
  Gender,
  MatchFinishRequest,
  MatchFinished,
  MatchStarted,
  MatchStartRequest,
  MeResponse,
  Profile,
  ProfilePatch,
  TxPage,
  WalletView,
} from './contract';
import { ApiError, ApiRequest, Method, Transport } from './transport';

export interface ApiClient {
  setToken(token: string | null): void;
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
  };
  wallet: {
    get(): Promise<WalletView>;
    transactions(cursor?: string | null, limit?: number): Promise<TxPage>;
  };
  matches: {
    start(req: MatchStartRequest): Promise<MatchStarted>;
    finish(matchId: string, req: MatchFinishRequest): Promise<MatchFinished>;
  };
}

export function createApi(transport: Transport): ApiClient {
  let token: string | null = null;

  async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const req: ApiRequest = { method, path, body, token };
    const res = await transport.send(req);
    if (res.status >= 200 && res.status < 300) return res.body as T;
    const err = (res.body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, (err?.code ?? 'internal') as ErrorCode, err?.message ?? `HTTP ${res.status}`);
  }

  return {
    setToken(next) {
      token = next;
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
    },
    wallet: {
      get: () => call('GET', '/v1/wallet'),
      transactions: (cursor, limit = 20) => {
        // Built by hand: URLSearchParams is incomplete in React Native.
        let q = `limit=${limit}`;
        if (cursor) q += `&cursor=${encodeURIComponent(cursor)}`;
        return call('GET', `/v1/wallet/transactions?${q}`);
      },
    },
    matches: {
      start: (req) => call('POST', '/v1/matches', req),
      finish: (matchId, req) => call('POST', `/v1/matches/${encodeURIComponent(matchId)}/finish`, req),
    },
  };
}
