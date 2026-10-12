// Game proposals: authors send ideas (not code), moderators answer, an
// approved proposal becomes a game in the registry. Routes of the server stub.

import {
  CHARACTER_IDS,
  CharacterId,
  GameEntry,
  PROPOSAL_DESCRIPTION_MAX,
  PROPOSAL_DESCRIPTION_MIN,
  PROPOSAL_TITLE_MAX,
  PROPOSAL_TITLE_MIN,
} from '../api/contract';
import type { Proposal, ProposalDraft, ProposalStatus } from '../api/contract';
import { fail, randomId } from './errors';
import { OFFER_VERSION, offerFor } from './offer';
import type { MockServer } from './server';

const MESSAGE_MAX = 1000;

/** Checks and cleans a draft; fails with invalid_input on the first problem. */
export function cleanDraft(raw: unknown): ProposalDraft {
  const d = (raw ?? {}) as Partial<ProposalDraft>;
  const title = typeof d.title === 'string' ? d.title.replace(/\s+/g, ' ').trim() : '';
  if (title.length < PROPOSAL_TITLE_MIN || title.length > PROPOSAL_TITLE_MAX) return fail(400, 'invalid_input', `Title must be ${PROPOSAL_TITLE_MIN}-${PROPOSAL_TITLE_MAX} characters`);
  const description = typeof d.description === 'string' ? d.description.trim() : '';
  if (description.length < PROPOSAL_DESCRIPTION_MIN || description.length > PROPOSAL_DESCRIPTION_MAX) {
    return fail(400, 'invalid_input', `Description must be ${PROPOSAL_DESCRIPTION_MIN}-${PROPOSAL_DESCRIPTION_MAX} characters`);
  }
  let universes: CharacterId[] | 'all';
  if (d.universes === 'all') universes = 'all';
  else if (Array.isArray(d.universes) && d.universes.length > 0 && d.universes.every((u) => (CHARACTER_IDS as readonly string[]).includes(u))) {
    universes = CHARACTER_IDS.filter((c) => (d.universes as string[]).includes(c));
  } else return fail(400, 'invalid_input', 'Universes must be "all" or a list of characters');
  let currency: ProposalDraft['currency'] = null;
  if (d.currency) {
    const code = typeof d.currency.code === 'string' ? d.currency.code.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{2,8}$/.test(code)) return fail(400, 'invalid_input', 'Currency code: 2-8 latin letters or digits');
    const abie = d.currency.rate?.abie;
    const units = d.currency.rate?.units;
    if (!Number.isInteger(abie) || !Number.isInteger(units) || (abie as number) < 1 || (units as number) < 1 || (abie as number) > 1_000_000 || (units as number) > 1_000_000) {
      return fail(400, 'invalid_input', 'Rate must be whole numbers above zero');
    }
    const share = d.currency.authorShare;
    if (!Number.isInteger(share) || (share as number) < 0 || (share as number) > 100) return fail(400, 'invalid_input', 'Author share must be a whole percent from 0 to 100');
    currency = { code, rate: { abie: abie as number, units: units as number }, authorShare: share as number };
  }
  let entry: ProposalDraft['entry'];
  if (d.entry?.kind === 'free') entry = { kind: 'free' };
  else if (d.entry?.kind === 'paid' && Number.isInteger(d.entry.price) && d.entry.price >= 1 && d.entry.price <= 1_000_000) entry = { kind: 'paid', price: d.entry.price };
  else return fail(400, 'invalid_input', 'Entry must be free or paid with a whole price in ABIE');
  return { title, description, universes, currency, entry };
}

export function registerProposalRoutes(s: MockServer) {
  const table = () => s.db.table<Proposal>('proposals');
  const own = (accountId: string, id: string): Proposal => {
    const p = table().get(id);
    return p && p.authorId === accountId ? p : fail(404, 'not_found', 'Unknown proposal');
  };

  s.route('GET', '/v1/offer', ({ query }) => offerFor(query.lang ?? 'en'));

  s.route('POST', '/v1/proposals', ({ req }): Proposal => {
    const accountId = s.accountIdFor(req);
    const body = (req.body ?? {}) as { offerVersion?: unknown; requestId?: unknown };
    if (typeof body.requestId !== 'string' || !body.requestId) return fail(400, 'invalid_input', 'requestId is required');
    const same = table()
      .values()
      .find((p) => p.authorId === accountId && (p as Proposal & { requestId?: string }).requestId === body.requestId);
    if (same) return same;
    if (body.offerVersion !== OFFER_VERSION) return fail(409, 'conflict', 'Accept the current offer first');
    const draft = cleanDraft(req.body);
    const now = s.now();
    const p: Proposal & { requestId: string } = {
      ...draft,
      id: randomId('prop'),
      authorId: accountId,
      status: 'review',
      offerVersion: OFFER_VERSION,
      createdAt: now,
      updatedAt: now,
      messages: [],
      requestId: body.requestId,
    };
    return table().put(p.id, p);
  });

  s.route('GET', '/v1/proposals', ({ req }) => {
    const accountId = s.accountIdFor(req);
    const items = table()
      .values()
      .filter((p) => p.authorId === accountId)
      .sort((a, b) => b.createdAt - a.createdAt);
    return { items };
  });

  s.route('GET', '/v1/proposals/{id}', ({ req, params }) => own(s.accountIdFor(req), params[0]));

  s.route('POST', '/v1/proposals/{id}/messages', ({ req, params }): Proposal => {
    const p = own(s.accountIdFor(req), params[0]);
    const text = typeof (req.body as { text?: unknown })?.text === 'string' ? ((req.body as { text: string }).text).trim() : '';
    if (!text || text.length > MESSAGE_MAX) return fail(400, 'invalid_input', `Message must be 1-${MESSAGE_MAX} characters`);
    const now = s.now();
    return table().put(p.id, { ...p, updatedAt: now, messages: [...p.messages, { id: randomId('msg'), ts: now, from: 'author', text }] });
  });

  s.route('PUT', '/v1/proposals/{id}', ({ req, params }): Proposal => {
    const p = own(s.accountIdFor(req), params[0]);
    if (p.status !== 'changes_requested') return fail(409, 'conflict', 'The proposal can be changed only when changes were asked for');
    const draft = cleanDraft(req.body);
    return table().put(p.id, { ...p, ...draft, status: 'review', updatedAt: s.now() });
  });
}

/**
 * What a moderator does with a proposal. On the Go server this is a route
 * for moderators only; in the stub it is reached through `server.dev`.
 */
export function moderate(s: MockServer, id: string, status: Exclude<ProposalStatus, 'review'>, message?: string): Proposal {
  const table = s.db.table<Proposal>('proposals');
  const p = table.get(id) ?? fail(404, 'not_found', 'Unknown proposal');
  if (p.status === 'approved' || p.status === 'rejected') return fail(409, 'conflict', 'This proposal is already decided');
  const now = s.now();
  const messages = message?.trim() ? [...p.messages, { id: randomId('msg'), ts: now, from: 'moderator' as const, text: message.trim() }] : p.messages;
  let gameId: string | undefined;
  if (status === 'approved') {
    const author = s.profile(p.authorId);
    const entry: GameEntry = {
      id: randomId('g', 8),
      title: p.title,
      universes: p.universes,
      currency: p.currency ? { code: p.currency.code, rate: { ...p.currency.rate }, settle: 'none' } : null,
      entry: p.entry,
      author: { accountId: p.authorId, nickname: author.nickname },
      authorShare: p.currency?.authorShare ?? 0,
      publishedAt: now,
    };
    gameId = s.publish(entry).id;
  }
  return table.put(p.id, { ...p, status, messages, updatedAt: now, ...(gameId ? { gameId } : {}) });
}
