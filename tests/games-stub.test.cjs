// Market Kombat rules and fights, game proposals, paid entries and author shares.
const assert = require('node:assert/strict');
const { MemoryKV } = require('../.stub-build/mock-server/db.js');
const { MockServer, makeMockGoogleToken } = require('../.stub-build/mock-server/server.js');
const { MockTransport } = require('../.stub-build/mock-server/transport.js');
const { createApi } = require('../.stub-build/api/client.js');
const { ApiError } = require('../.stub-build/api/transport.js');
const K = require('../.stub-build/game/kombat.js');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const expectErr = async (p, code) => { try { await p; assert.fail('expected ' + code); } catch (e) { assert.ok(e instanceof ApiError, String(e)); assert.equal(e.code, code); } };

(async () => {
  const kv = new MemoryKV();
  const server = new MockServer(kv);
  const sim = { latency: false, failures: false };
  const player = async (name, character) => {
    const api = createApi(new MockTransport(server, () => sim));
    const res = await api.auth.google(makeMockGoogleToken({ sub: 'g-' + name, email: name + '@gmail.com', name }));
    api.setToken(res.session.token);
    if (character) await api.me.chooseCharacter(character, 'm');
    api.id = res.account.id;
    return api;
  };
  const balance = async (api) => (await api.wallet.get()).balance;
  const grant = async (accountId, amount, id) => { server.wallet.post(accountId, { id, kind: 'welcome', amount }); await server.wallet.flush(); };

  // ------------------------------------------------------------ rules
  await t('kombat rules: the same seed and moves give the same fight', () => {
    const play = () => {
      let s = K.createKombat(42, { character: 'waldberik' }, { character: 'avitos' });
      const seq = [['strike', 'charge'], ['charge', 'block'], ['strike', 'strike'], ['special', 'block'], ['block', 'strike']];
      for (const m of seq) s = K.resolveTurn(s, m);
      return s;
    };
    assert.deepEqual(play(), play());
  });

  await t('kombat rules: block stops a strike, combo gets past a block, strike breaks a combo', () => {
    const s0 = K.createKombat(7, { character: 'ozonik' }, { character: 'yandos' });
    const a = K.resolveTurn(s0, ['strike', 'block']);
    assert.equal(a.log[0].damage[1], 0);
    assert.equal(a.fighters[1].energy, K.KOMBAT_START_ENERGY + K.KOMBAT_BLOCK_ENERGY + K.KOMBAT_REGEN);
    const b = K.resolveTurn(s0, ['charge', 'block']);
    assert.equal(b.fighters[0].combo, 1);
    assert.equal(b.log[0].damage[0] + b.log[0].damage[1], 0);
    const c = K.resolveTurn(s0, ['strike', 'charge']);
    assert.ok(c.log[0].damage[1] >= Math.floor(K.KOMBAT_STRIKE * 0.85 * 1.25));
    assert.equal(c.fighters[1].combo, 0);
  });

  await t('kombat rules: a special needs energy; without it the move counts as a block', () => {
    const s0 = K.createKombat(9, { character: 'waldberik' }, { character: 'ozonik' });
    const a = K.resolveTurn(s0, ['special', 'strike']);
    assert.equal(a.log[0].moves[0], 'block');
    let s = s0;
    for (let i = 0; i < 2; i++) s = K.resolveTurn(s, ['block', 'block']);
    assert.ok(K.canUse(s.fighters[0], 'special'));
    const b = K.resolveTurn(s, ['special', 'block']);
    assert.equal(b.log.at(-1).moves[0], 'special');
    assert.ok(b.log.at(-1).damage[1] > 0, 'a block only halves a special');
  });

  await t('kombat rules: a knockout or the last turn ends the fight', () => {
    let s = K.createKombat(3, { character: 'yandos' }, { character: 'avitos' });
    while (!s.finished) s = K.resolveTurn(s, ['strike', 'charge']);
    assert.equal(s.winner, 0);
    assert.equal(s.reason, 'ko');
    let d = K.createKombat(4, { character: 'yandos' }, { character: 'avitos' });
    while (!d.finished) d = K.resolveTurn(d, ['block', 'block']);
    assert.equal(d.log.length, K.KOMBAT_MAX_TURNS);
    assert.deepEqual([d.winner, d.reason], [null, 'turns']);
  });

  // ------------------------------------------------------------ fights
  const a = await player('ann', 'waldberik');
  const b = await player('bob', 'ozonik');

  await t('kombat: training with the computer has no stake and nothing to win', async () => {
    const before = await balance(a);
    let v = await a.kombat.start('bot', undefined, 'tr1');
    assert.deepEqual([v.mode, v.status, v.stake, v.fighters[1].isBot], ['bot', 'active', 0, true]);
    while (v.status === 'active') v = await a.kombat.move(v.id, v.turn, 'strike');
    assert.equal(v.status, 'finished');
    assert.deepEqual([v.settlement.payout, v.settlement.net, v.settlement.tx], [0, 0, null]);
    assert.equal(await balance(a), before);
    assert.equal((await a.me.get()).profile.stats.matches, 0);
  });

  await t('kombat: moves are hidden until the turn is played; the timer plays a missing move as a block', async () => {
    const w = await a.kombat.start('pvp', 10, 'p1');
    assert.equal(w.status, 'waiting');
    assert.equal(await balance(a), 90);
    const j = await b.kombat.start('pvp', 10, 'p1');
    assert.deepEqual([j.status, j.you, j.fighters[0].nickname.length > 0], ['active', 1, true]);
    const mineA = await a.kombat.move(j.id, 1, 'strike');
    assert.equal(mineA.myMove, 'strike');
    const seenByB = await b.kombat.get(j.id);
    assert.equal(seenByB.myMove, null);
    assert.equal(seenByB.last, null);
    assert.ok(!JSON.stringify(seenByB).includes('strike'), 'B must not see what A chose');
    const realNow = server.now;
    server.now = () => realNow() + 13_000;
    const after = await b.kombat.get(j.id);
    assert.deepEqual(after.last.moves, ['strike', 'block']);
    assert.equal(after.turn, 2);
    server.now = realNow;
    globalThis.fight = j.id;
  });

  await t('kombat: the winner takes both stakes minus 10% of the win; the loser loses the stake', async () => {
    let v = await a.kombat.get(globalThis.fight);
    while (v.status === 'active') {
      await a.kombat.move(v.id, v.turn, 'strike');
      v = await b.kombat.move(v.id, v.turn, 'charge');
    }
    const sa = (await a.kombat.get(v.id)).settlement;
    const sb = v.settlement;
    assert.equal(sa.winner, 0);
    // Stakes 100 chips each (10 ABIE); win 100, fee 10; back 190 chips = 19 ABIE.
    assert.deepEqual([sa.back, sa.fee, sa.payout, sa.net], [190, 10, 19, 9]);
    assert.deepEqual([sb.back, sb.payout, sb.net], [0, 0, -10]);
    assert.equal(await balance(a), 109);
    assert.equal(await balance(b), 90);
    assert.deepEqual((await a.me.get()).profile.stats, { matches: 1, wins: 1, earned: 9 });
    assert.ok(await server.dev.walletAudit());
  });

  await t('kombat: leaving a waiting fight returns the stake, leaving a fight loses it', async () => {
    const w = await a.kombat.start('pvp', 5, 'p2');
    assert.equal(await balance(a), 104);
    const c = await a.kombat.leave(w.id);
    assert.equal(c.status, 'cancelled');
    assert.equal(await balance(a), 109);
    await a.kombat.start('pvp', 5, 'p3');
    const j = await b.kombat.start('pvp', 5, 'p3');
    const left = await b.kombat.leave(j.id);
    assert.deepEqual([left.status, left.settlement.winner, left.settlement.reason], ['finished', 0, 'forfeit']);
  });

  await t('kombat: energy boost is dear, bought once per key, spent one pvp fight at a time', async () => {
    await expectErr(a.kombat.buyBoost('boost5', 'k1'), 'insufficient_funds');
    await grant(a.id, 5000, 'test-grant-a');
    const r1 = await a.kombat.buyBoost('boost5', 'k2');
    const r2 = await a.kombat.buyBoost('boost5', 'k2');
    assert.equal(r1.tx.id, r2.tx.id);
    assert.equal((await a.kombat.boost()).fightsLeft, 5);
    let tr = await a.kombat.start('bot', undefined, 'tr2');
    assert.equal(tr.fighters[0].boosted, false);
    await a.kombat.leave(tr.id);
    assert.equal((await a.kombat.boost()).fightsLeft, 5, 'training does not spend a boost');
    await a.kombat.start('pvp', 5, 'p4');
    const j = await b.kombat.start('pvp', 5, 'p4');
    assert.deepEqual([j.fighters[0].boosted, j.fighters[1].boosted], [true, false]);
    assert.equal((await a.kombat.boost()).fightsLeft, 4);
    await b.kombat.leave(j.id);
  });

  await t('kombat: the test opponent of the developer panel joins a waiting fight and plays', async () => {
    server.devSettings.sparring = true;
    const w = await b.kombat.start('pvp', 5, 'sp1');
    const realNow = server.now;
    server.now = () => realNow() + 2000;
    let v = await b.kombat.get(w.id);
    assert.equal(v.status, 'active');
    assert.equal(v.fighters[0].nickname.length > 0 && v.fighters[1].nickname, 'Sparring');
    server.now = realNow;
    while (v.status === 'active') v = await b.kombat.move(v.id, v.turn, 'block');
    assert.equal(v.status, 'finished');
    server.devSettings.sparring = false;
  });

  // ------------------------------------------------------------ proposals
  const author = await player('ava', 'avitos');
  const draft = {
    title: 'Hub Quiz',
    description: 'Answer questions about the blue hub faster than other packers.',
    universes: ['ozonik'],
    currency: { code: 'qz', rate: { abie: 1, units: 5 }, authorShare: 30 },
    entry: { kind: 'paid', price: 20 },
  };

  await t('proposals: the offer must be accepted; bad drafts are refused', async () => {
    const offer = await author.proposals.offer('ru');
    assert.equal(offer.draft, true);
    assert.ok(offer.paragraphs.length > 5);
    await expectErr(author.proposals.create(draft, 'old-version', 'r0'), 'conflict');
    await expectErr(author.proposals.create({ ...draft, title: 'x' }, offer.version, 'r0'), 'invalid_input');
    await expectErr(author.proposals.create({ ...draft, currency: { ...draft.currency, rate: { abie: 1.5, units: 5 } } }, offer.version, 'r0'), 'invalid_input');
    await expectErr(author.proposals.create({ ...draft, entry: { kind: 'paid', price: 0 } }, offer.version, 'r0'), 'invalid_input');
    globalThis.offerVersion = offer.version;
  });

  await t('proposals: sent once per key, talk with the moderator, changes, approval publishes the game', async () => {
    const p = await author.proposals.create(draft, globalThis.offerVersion, 'r1');
    const again = await author.proposals.create(draft, globalThis.offerVersion, 'r1');
    assert.equal(again.id, p.id);
    assert.deepEqual([p.status, p.currency.code], ['review', 'QZ']);
    assert.equal((await author.proposals.list()).items.length, 1);
    await expectErr(author.proposals.update(p.id, draft), 'conflict');
    await server.dev.moderate(p.id, 'changes_requested', 'Make the rounds shorter.');
    const asked = await author.proposals.get(p.id);
    assert.deepEqual([asked.status, asked.messages[0].from], ['changes_requested', 'moderator']);
    await author.proposals.message(p.id, 'Done: rounds are 30 seconds now.');
    const changed = await author.proposals.update(p.id, { ...draft, description: draft.description + ' Rounds last 30 seconds.' });
    assert.equal(changed.status, 'review');
    const approved = await server.dev.moderate(p.id, 'approved', 'Welcome aboard.');
    assert.ok(approved.gameId);
    await assert.rejects(server.dev.moderate(p.id, 'rejected'), /already decided/);
    const g = (await author.games.list()).items.find((x) => x.id === approved.gameId);
    assert.deepEqual([g.title, g.universes, g.entry, g.authorShare, g.author.accountId], ['Hub Quiz', ['ozonik'], { kind: 'paid', price: 20 }, 30, author.id]);
    assert.deepEqual(g.currency, { code: 'QZ', rate: { abie: 1, units: 5 }, settle: 'none' });
    await assert.rejects(server.dev.publishGame({ ...g, authorShare: 90 }), /already published/);
    globalThis.quiz = g.id;
  });

  await t('paid entry: once per player, 10% to the platform, the rest to the author; author share of currency sales', async () => {
    const q = globalThis.quiz;
    await expectErr(b.games.buyCurrency(q, 1, 'q0'), 'payment_required');
    await expectErr(a.games.payEntry(q, 'e0').then(() => a.games.buyCurrency(q, 1, 'q0')), 'forbidden');
    const platform0 = server.wallet.balance('platform');
    const author0 = await balance(author);
    const b0 = await balance(b);
    const e1 = await b.games.payEntry(q, 'e1');
    const e2 = await b.games.payEntry(q, 'e2');
    assert.equal(e1.tx.id, e2.tx.id);
    assert.equal(await balance(b), b0 - 20);
    assert.ok((await b.games.list()).opened.includes(q));
    // Entry 20: platform 2, author 18.
    assert.equal(server.wallet.balance('platform') - platform0, 2);
    assert.equal((await balance(author)) - author0, 18);
    // 10 ABIE of currency: author 30% = 3, platform 7.
    const buy = await b.games.buyCurrency(q, 10, 'q1');
    assert.deepEqual([buy.tx.amount, buy.currency.balance], [-10, 50]);
    assert.equal((await balance(author)) - author0, 21);
    assert.equal(server.wallet.balance('platform') - platform0, 9);
    assert.ok(await server.dev.walletAudit());
  });

  await t('rename: Waldberik; profiles saved with the old id are read with the new one', async () => {
    const old = server.db.table('profiles').get(a.id);
    server.db.table('profiles').put(a.id, { ...old, character: 'valdberik', skins: ['valdberik', 'ozonik', 'avitos', 'yandos'] });
    const me = await a.me.get();
    assert.equal(me.profile.character, 'waldberik');
    assert.deepEqual(me.profile.skins, ['waldberik', 'ozonik', 'avitos', 'yandos']);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
