// Ledger rules for ABIE and for game currencies. Pure functions, no storage:
// the services (today the stub in src/mock-server, later the Go server) keep
// the data.
//
// Every change of balance is an operation with a unique id, a kind, a signed
// amount and the balance after it. Posting the same id twice changes
// nothing; a debit can never take the balance below zero (only the platform
// account may go below zero: that shows players won more from it than it
// took in); history is only appended, never edited.

import type { TxKind } from '../api/contract';

export interface LedgerEntry<K extends string = TxKind> {
  id: string;
  ts: number;
  kind: K;
  amount: number;
  balanceAfter: number;
  ref?: string;
}

export interface LedgerState<K extends string = TxKind> {
  balance: number;
  /** Oldest first. */
  txs: LedgerEntry<K>[];
}

export interface PostRequest<K extends string = TxKind> {
  id: string;
  kind: K;
  amount: number;
  ref?: string;
}

export type PostResult<K extends string = TxKind> =
  | { ok: true; state: LedgerState<K>; tx: LedgerEntry<K>; duplicate: boolean }
  | { ok: false; error: 'insufficient_funds' | 'invalid_amount' };

export const WELCOME_BONUS = 100;

export function emptyLedger<K extends string = TxKind>(): LedgerState<K> {
  return { balance: 0, txs: [] };
}

export function post<K extends string = TxKind>(
  state: LedgerState<K>,
  req: PostRequest<K>,
  now: number,
  opts: { allowNegative?: boolean } = {},
): PostResult<K> {
  const existing = state.txs.find((t) => t.id === req.id);
  if (existing) return { ok: true, state, tx: existing, duplicate: true };
  if (!Number.isInteger(req.amount) || req.amount === 0) return { ok: false, error: 'invalid_amount' };
  const balanceAfter = state.balance + req.amount;
  if (balanceAfter < 0 && !opts.allowNegative) return { ok: false, error: 'insufficient_funds' };
  const tx: LedgerEntry<K> = { id: req.id, ts: now, kind: req.kind, amount: req.amount, balanceAfter };
  if (req.ref !== undefined) tx.ref = req.ref;
  return { ok: true, state: { balance: balanceAfter, txs: [...state.txs, tx] }, tx, duplicate: false };
}

/** Recomputes the balance from history; used to check the stored balance. */
export function replay(txs: { amount: number }[]): number {
  return txs.reduce((sum, t) => sum + t.amount, 0);
}
