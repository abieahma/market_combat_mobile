// ABIE wallet service. Lives next to the game with its own database
// ("abie_wallet"), so it can later become a separate payment system.
// Games never touch balances directly; they ask this service to post an
// operation.

import type { TxPage, WalletTx } from '../api/contract';
import { emptyLedger, LedgerState, post, PostRequest, replay } from '../wallet/ledger';
import { Database, KeyValue } from './db';

export class WalletError extends Error {
  constructor(readonly code: 'insufficient_funds' | 'invalid_amount') {
    super(code);
  }
}

export class WalletService {
  private readonly db: Database;

  constructor(kv: KeyValue) {
    this.db = new Database(kv, 'abie_wallet', ['ledgers']);
  }

  open() {
    return this.db.open();
  }

  flush() {
    return this.db.flush();
  }

  wipe() {
    return this.db.wipe();
  }

  private ledger(accountId: string): LedgerState {
    return this.db.table<LedgerState>('ledgers').get(accountId) ?? emptyLedger();
  }

  /** True when an operation with this id was already posted. */
  has(accountId: string, txId: string): boolean {
    return this.ledger(accountId).txs.some((t) => t.id === txId);
  }

  balance(accountId: string): number {
    return this.ledger(accountId).balance;
  }

  /** Posts one operation. Same id twice = the first result, nothing charged again. */
  post(accountId: string, req: PostRequest, now = Date.now()): WalletTx {
    const res = post(this.ledger(accountId), req, now);
    if (!res.ok) throw new WalletError(res.error);
    if (!res.duplicate) this.db.table<LedgerState>('ledgers').put(accountId, res.state);
    return res.tx;
  }

  /** Newest first. The cursor is the number of operations already returned. */
  page(accountId: string, cursor: string | null, limit: number): TxPage {
    const all = this.ledger(accountId).txs;
    const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    const size = Math.max(1, Math.min(100, Math.floor(limit) || 20));
    const newestFirst = all.slice().reverse();
    const items = newestFirst.slice(offset, offset + size);
    const next = offset + items.length;
    return { items, nextCursor: next < newestFirst.length ? String(next) : null };
  }

  /** True when every stored balance equals the sum of its history. */
  audit(): boolean {
    return this.db
      .table<LedgerState>('ledgers')
      .values()
      .every((l) => replay(l.txs) === l.balance);
  }
}
