// Errors and ids shared by the server stub's route modules.

import type { ErrorCode } from '../api/contract';

export class ServerError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (status: number, code: ErrorCode, message: string): never => {
  throw new ServerError(status, code, message);
};

export function randomId(prefix: string, length = 16): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${s}`;
}
