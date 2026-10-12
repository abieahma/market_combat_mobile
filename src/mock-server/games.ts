// Games published on the platform. Publishing writes an entry into the
// server's game registry once; after that the entry never changes: the
// universes, the currency and its rate, the entry price and the author's
// share stay as published. On the Go server the same rule is held by the
// database itself (docs/db/games.sql).

import { CHARACTER_IDS, GameEntry } from '../api/contract';

/**
 * Code of the currency of a game that trades in the player's own money:
 * 1 ABIE = 1 unit of the money of the country of registration, counted in
 * hundredths (kopecks, tiyns, cents) so trading results are not rounded away.
 */
export const LOCAL_MONEY = 'LOCAL';

/**
 * Before the Go server goes live, the platform's own games in the stub may be
 * re-published with a higher revision (their terms were still being set).
 * Games of authors are never touched; on the Go server nothing is.
 */
export const PLATFORM_REVISIONS: Record<string, number> = { duel: 2, kombat: 1 };

export const PUBLISHED_GAMES: GameEntry[] = [
  {
    id: 'duel',
    universes: 'all',
    // Trading in the player's own money: 1 ABIE = 1 ₽ in Russia, 1 ₸ in Kazakhstan, $1 in the USA.
    // Units are hundredths (kopecks, tiyns, cents), so 1 ABIE = 100 units.
    currency: { code: LOCAL_MONEY, rate: { abie: 1, units: 100 }, settle: 'match' },
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
