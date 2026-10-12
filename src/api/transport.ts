// How requests reach the server. Today: MockTransport (the server stub inside
// the app). Later: an HTTP transport to the Go server with the same shape.

import type { ErrorCode } from './contract';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequest {
  method: Method;
  path: string;
  body?: unknown;
  token?: string | null;
  /** Region of the device (X-Region header): a weak hint for the country of a new cabinet. */
  region?: string | null;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface Transport {
  send(req: ApiRequest): Promise<ApiResponse>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Real server over HTTPS; not used until the Go server exists. */
export class HttpTransport implements Transport {
  constructor(private readonly baseUrl: string) {}

  async send(req: ApiRequest): Promise<ApiResponse> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + req.path, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          ...(req.token ? { Authorization: `Bearer ${req.token}` } : {}),
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
    } catch {
      throw new ApiError(0, 'network', 'No connection to the server');
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}
