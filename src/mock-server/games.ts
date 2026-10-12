// Games published on the platform. Publishing writes an entry into the
// server's game registry once; after that the entry never changes: the
// universes, the currency and its rate, the entry price and the author's
// share stay as published. On the Go server the same rule is held by the
// database itself (docs/db/games.sql).

import { CHARACTER_IDS, GameEntry } from '../api/contract';

export const PUBLISHED_GAMES: GameEntry[] = [
  {
    id: 'duel',
    universes: 'all',
    // Chart Duel dollars: 1 ABIE buys $100; a $10,000 stake costs 100 ABIE.
    currency: { code: 'DUSD', rate: { abie: 1, units: 100 }, settle: 'match' },
    entry: { kind: 'free' },
    author: null,
    authorShare: 0,
    publishedAt: Date.UTC(2026, 9, 12),
  },
  {
    id: 'kombat',
    universes: 'all',
    // Fight chips: 1 ABIE buys 10 chips.
    currency: { code: 'KMB', rate: { abie: 1, units: 10 }, settle: 'match' },
    entry: { kind: 'free' },
    author: null,
    authorShare: 0,
    publishedAt: Date.UTC(2026, 9, 13),
  },
];

/** Entries saved before entry prices and authors existed are free platform games. */
export function normalizeGame(g: GameEntry): GameEntry {
  const old = g as Partial<GameEntry> & Pick<GameEntry, 'id' | 'universes' | 'currency' | 'publishedAt'>;
  return { ...g, entry: old.entry ?? { kind: 'free' }, author: old.author ?? null, authorShare: old.authorShare ?? 0 };
}

/** Problems with an entry that is about to be published, or null if it is fine. */
export function gameEntryProblem(e: GameEntry): string | null {
  if (!e.id) return 'id is required';
  if (e.universes !== 'all') {
    if (!Array.isArray(e.universes) || e.universes.length === 0) return 'universes must be "all" or a non-empty list';
    if (!e.universes.every((u) => (CHARACTER_IDS as readonly string[]).includes(u))) return 'unknown universe';
  }
  if (e.currency) {
    const { abie, units } = e.currency.rate;
    if (!Number.isInteger(abie) || !Number.isInteger(units) || abie < 1 || units < 1) return 'rate must be whole numbers above zero';
    if (!e.currency.code) return 'currency code is required';
    if (e.currency.settle !== 'match' && e.currency.settle !== 'none') return 'unknown settle mode';
  }
  const entry = e.entry ?? { kind: 'free' };
  if (entry.kind === 'paid' && (!Number.isInteger(entry.price) || entry.price < 1)) return 'entry price must be a whole number of ABIE above zero';
  const share = e.authorShare ?? 0;
  if (!Number.isInteger(share) || share < 0 || share > 100) return 'author share must be a whole percent from 0 to 100';
  return null;
}
