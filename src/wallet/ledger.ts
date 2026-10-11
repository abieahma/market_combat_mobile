// ABIE ledger rules. Pure functions, no storage: the wallet service (today
// the stub in src/mock-server, later the Go server) keeps the data.
//
// Every change of balance is an operation with a unique id, a kind, a signed
// amount and the balance after it. Posting the same id twice changes
// nothing; a debit can never take the balance below zero; history is only
// appended, never edited.

import type { TxKind, WalletTx } from '../api/contract';

export interface LedgerState {
  balance: number;
  /** Oldest first. */
  txs: WalletTx[];
}

export interface PostRequest {
  id: string;
  kind: TxKind;
  amount: number;
  ref?: string;
}

export type PostResult =
  | { ok: true; state: LedgerState; tx: WalletTx; duplicate: boolean }
  | { ok: false; error: 'insufficient_funds' | 'invalid_amount' };

export const WELCOME_BONUS = 100;

export function emptyLedger(): LedgerState {
  return { balance: 0, txs: [] };
}

export function post(state: LedgerState, req: PostRequest, now: number): PostResult {
  const existing = state.txs.find((t) => t.id === req.id);
  if (existing) return { ok: true, state, tx: existing, duplicate: true };
  if (!Number.isInteger(req.amount) || req.amount === 0) return { ok: false, error: 'invalid_amount' };
  const balanceAfter = state.balance + req.amount;
  if (balanceAfter < 0) return { ok: false, error: 'insufficient_funds' };
  const tx: WalletTx = { id: req.id, ts: now, kind: req.kind, amount: req.amount, balanceAfter };
  if (req.ref !== undefined) tx.ref = req.ref;
  return { ok: true, state: { balance: balanceAfter, txs: [...state.txs, tx] }, tx, duplicate: false };
}

/** Recomputes the balance from history; used to check the stored balance. */
export function replay(txs: WalletTx[]): number {
  return txs.reduce((sum, t) => sum + t.amount, 0);
}
