// History of games on the server stub: the player's finished Chart Duel
// matches and Market Kombat fights, newest first, and the details of one.

import type { DuelRecord, HistoryDetail, HistoryItem, HistoryPage } from '../api/contract';
import { MATCH_SECONDS } from '../game/duel';
import { fail } from './errors';
import type { KombatHistory } from './kombat';
import type { MatchRow, MockServer } from './server';

const PAGE = 20;
const MAX_PAGE = 50;

export function registerHistoryRoutes(s: MockServer, kombat: KombatHistory) {
  const matches = () => s.db.table<MatchRow>('matches');

  const matchItem = (m: MatchRow): HistoryItem => {
    const done = m.finished!;
    return {
      id: m.id,
      game: m.game,
      startedAt: m.startedAt,
      // Matches finished before the history existed have no finish time: the bell is close enough.
      finishedAt: m.finishedAt ?? m.startedAt + MATCH_SECONDS * 1000,
      outcome: done.abandoned ? 'abandoned' : done.place === 1 ? 'win' : 'loss',
      place: done.abandoned ? null : done.place,
      players: 4,
      mode: null,
      opponent: null,
      turns: null,
      stake: m.stake ?? 0,
      net: done.net,
    };
  };

  const all = (accountId: string): HistoryItem[] => {
    s.settleStale(accountId);
    const duel = matches()
      .values()
      .filter((m) => m.accountId === accountId && m.finished)
      .map(matchItem);
    return [...duel, ...kombat.items(accountId)].sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt));
  };

  s.route('GET', '/v1/history', ({ req, query }): HistoryPage => {
    const accountId = s.accountIdFor(req);
    const from = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0);
    const limit = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(query.limit ?? String(PAGE), 10) || PAGE));
    const items = all(accountId).filter((i) => !query.game || i.game === query.game);
    const page = items.slice(from, from + limit);
    return { items: page, next: from + limit < items.length ? String(from + limit) : null };
  });

  s.route('GET', '/v1/history/{id}', ({ req, params }): HistoryDetail => {
    const accountId = s.accountIdFor(req);
    const id = params[0];
    const m = matches().get(id);
    if (m && m.accountId === accountId && m.finished) {
      const duel: DuelRecord = {
        replayable: m.actions !== undefined && !m.finished.abandoned,
        seed: m.seed,
        stake: m.stake ?? 0,
        nickname: m.nickname ?? s.profile(accountId).nickname,
        actions: m.actions ?? [],
        endTick: m.endTick ?? null,
        equity: m.finished.equity,
        place: m.finished.place,
        fee: m.finished.fee,
        payout: m.finished.payout,
      };
      return { item: matchItem(m), duel };
    }
    const view = kombat.view(accountId, id);
    const item = view ? kombat.items(accountId).find((i) => i.id === id) : undefined;
    if (!view || !item) return fail(404, 'not_found', 'Unknown game in the history');
    return { item, kombat: view };
  });
}
