const assert = require('node:assert/strict');
const { MemoryKV } = require('../.stub-build/mock-server/db.js');
const { MockServer, makeMockGoogleToken } = require('../.stub-build/mock-server/server.js');
const { MockTransport } = require('../.stub-build/mock-server/transport.js');
const { createApi } = require('../.stub-build/api/client.js');
const { ApiError } = require('../.stub-build/api/transport.js');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const expectErr = async (p, code) => { try { await p; assert.fail('expected ' + code); } catch (e) { assert.ok(e instanceof ApiError, String(e)); assert.equal(e.code, code); } };

(async () => {
  const kv = new MemoryKV();
  let server = new MockServer(kv);
  const sim = { latency: false, failures: false };
  let api = createApi(new MockTransport(server, () => sim));
  const inbox = [];
  server.dev.onInbox((m) => inbox.push(m));
  let accountId, token;

  await t('email: bad address rejected', () => expectErr(api.auth.emailStart('nope'), 'invalid_input'));

  await t('email: code arrives, wrong code rejected, right code signs in (new account, 100 ABIE)', async () => {
    const ch = await api.auth.emailStart('  Player@Example.com ');
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].to, 'player@example.com');
    await expectErr(api.auth.emailVerify(ch.challengeId, '000000' === inbox[0].code ? '111111' : '000000'), 'invalid_code');
    const res = await api.auth.emailVerify(ch.challengeId, inbox[0].code);
    assert.equal(res.isNew, true);
    accountId = res.account.id; token = res.session.token;
    api.setToken(token);
    globalThis.mainToken = token;
    assert.equal((await api.wallet.get()).balance, 100);
    await expectErr(api.auth.emailVerify(ch.challengeId, inbox[0].code), 'challenge_expired');
  });

  await t('email: resend is rate limited for 30 s', async () => {
    await api.auth.emailStart('other@example.com');
    await expectErr(api.auth.emailStart('other@example.com'), 'rate_limited');
  });

  await t('email: 5 wrong attempts expire the code', async () => {
    const ch = await api.auth.emailStart('brute@example.com');
    for (let i = 0; i < 5; i++) await expectErr(api.auth.emailVerify(ch.challengeId, 'x' + i), 'invalid_code');
    await expectErr(api.auth.emailVerify(ch.challengeId, inbox.at(-1).code), 'challenge_expired');
  });

  await t('profile: nickname rules', async () => {
    await expectErr(api.me.patch({ nickname: 'a' }), 'invalid_input');
    const p = await api.me.patch({ nickname: '  Bull   Run ' });
    assert.equal(p.nickname, 'Bull Run');
  });

  const { MATCH_STALE_MS } = require('../.stub-build/mock-server/server.js');
  let balanceNow = 100;

  await t('games: Chart Duel is common to all universes, its own currency has a fixed rate', async () => {
    const { items } = await api.games.list();
    const duel = items.find((g) => g.id === 'duel');
    assert.equal(duel.universes, 'all');
    assert.deepEqual(duel.currency, { code: 'LOCAL', rate: { abie: 1, units: 100 }, settle: 'match' });
  });

  await t('matches: no character, no game', async () => {
    await expectErr(api.matches.start({ game: 'duel', stakeLots: 10, requestId: 'nochar' }), 'conflict');
    await expectErr(api.games.buyCurrency('duel', 1, 'nochar'), 'conflict');
    await api.me.chooseCharacter('waldberik', 'm');
  });

  await t('duel: stake bought with ABIE, same request = same match, profit back minus 10%, no prizes', async () => {
    const m = await api.matches.start({ game: 'duel', stakeLots: 10, requestId: 's1' });
    assert.equal(m.stake, 1000);
    assert.equal(m.tx.kind, 'currency_buy');
    assert.equal(m.tx.amount, -10);
    assert.equal((await api.wallet.get()).balance, 90);
    const again = await api.matches.start({ game: 'duel', stakeLots: 10, requestId: 's1' });
    assert.equal(again.matchId, m.matchId);
    assert.equal((await api.wallet.get()).balance, 90);
    await expectErr(api.matches.finish(m.matchId, { place: 1, equity: -5, actions: [] }), 'invalid_input');
    await expectErr(api.matches.finish(m.matchId, { place: 1, equity: 12.5, actions: [] }), 'invalid_input');
    const r1 = await api.matches.finish(m.matchId, { place: 1, equity: 1230, actions: [] });
    // profit 230, fee 23 (10% rounded up), back 1207 = 12 ABIE
    assert.deepEqual([r1.profit, r1.fee, r1.payout, r1.net], [230, 23, 12, 2]);
    assert.equal(r1.tx.kind, 'currency_return');
    const r2 = await api.matches.finish(m.matchId, { place: 1, equity: 99999, actions: [] });
    assert.deepEqual(r1, r2);
    assert.equal((await api.wallet.get()).balance, 102);
    assert.deepEqual((await api.me.get()).profile.stats, { matches: 1, wins: 1, earned: 2 });
  });

  await t('duel: a loss returns what is left, no fee', async () => {
    const m = await api.matches.start({ game: 'duel', stakeLots: 10, requestId: 's2' });
    const r = await api.matches.finish(m.matchId, { place: 4, equity: 640, actions: [] });
    assert.deepEqual([r.profit, r.fee, r.payout, r.net], [-360, 0, 6, -4]);
    const zero = await api.matches.start({ game: 'duel', stakeLots: 5, requestId: 's3' });
    const z = await api.matches.finish(zero.matchId, { place: 4, equity: 0, actions: [] });
    assert.deepEqual([z.fee, z.payout, z.net, z.tx], [0, 0, -5, null]);
    assert.equal((await api.wallet.get()).balance, 93);
    assert.deepEqual((await api.me.get()).profile.stats, { matches: 3, wins: 1, earned: -7 });
  });

  await t('currency: bought only with ABIE, once per key, ABIE go to the platform', async () => {
    const b1 = await api.games.buyCurrency('duel', 3, 'b1');
    assert.deepEqual([b1.tx.amount, b1.currency.balance], [-3, 300]);
    const b1again = await api.games.buyCurrency('duel', 3, 'b1');
    assert.equal(b1again.tx.id, b1.tx.id);
    assert.equal((await api.games.currency('duel')).balance, 300);
    await expectErr(api.games.buyCurrency('duel', 1000, 'b2'), 'insufficient_funds');
    await expectErr(api.games.buyCurrency('duel', 0, 'b3'), 'invalid_input');
    // A stake uses what is already there and buys only the rest (2 lots).
    const m = await api.matches.start({ game: 'duel', stakeLots: 5, requestId: 's4' });
    assert.equal(m.tx.amount, -2);
    assert.equal((await api.games.currency('duel')).balance, 0);
    await api.matches.finish(m.matchId, { place: 2, equity: 500, actions: [] });
    assert.equal((await api.wallet.get()).balance, 93);
    // Sold 10+10+5+3+2 = 30, paid back 12+6+0+5 = 23.
    assert.equal(server.wallet.balance('platform'), 7);
    assert.ok(await server.dev.walletAudit());
  });

  await t('history: a duel match is kept with its actions, and its replay is the same match', async () => {
    const D = require('../.stub-build/game/duel.js');
    const api = createApi(new MockTransport(server, () => sim));
    api.setToken((await api.auth.google(makeMockGoogleToken({ sub: 'g-hist', email: 'hist@gmail.com', name: 'Hist' }))).session.token);
    await api.me.chooseCharacter('yandos', 'f');
    const m = await api.matches.start({ game: 'duel', stakeLots: 5, requestId: 'h1' });
    const nickname = (await api.me.get()).profile.nickname;
    // Play the match the way the screen does: actions between ticks, the player leaves at tick 150.
    let duel = D.createDuel(m.seed, D.duelSlots(nickname), m.stake);
    const plan = { 10: { type: 'open', side: 1, leverage: 5 }, 60: { type: 'close' }, 80: { type: 'open', side: -1, leverage: 2 } };
    const actions = [];
    while (duel.tick < 150) {
      const a = plan[duel.tick];
      if (a) {
        duel = D.applyAction(duel, D.DUEL_ME, a);
        actions.push({ tick: duel.tick, ...a });
      }
      duel = D.stepDuel(duel);
    }
    const final = D.standings(duel);
    const mine = final.find((x) => x.trader.id === D.DUEL_ME);
    const equity = Math.floor(mine.equity);
    await api.matches.finish(m.matchId, { place: mine.place, equity, actions, endTick: duel.tick });
    assert.ok(duel.log.some((e) => e.type === 'open' && e.traderId !== D.DUEL_ME), 'the feed has the bots too');
    assert.ok(duel.log.some((e) => e.type === 'close' && e.traderId === D.DUEL_ME));

    const page = await api.history.list('duel');
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, m.matchId);
    assert.deepEqual([page.items[0].place, page.items[0].players, page.items[0].stake], [mine.place, 4, 500]);
    const detail = await api.history.get(m.matchId);
    assert.deepEqual([detail.duel.seed, detail.duel.endTick, detail.duel.nickname, detail.duel.actions], [m.seed, 150, nickname, actions]);
    const states = D.replayDuel(detail.duel.seed, detail.duel.stake, detail.duel.nickname, detail.duel.actions, detail.duel.endTick);
    const last = states[states.length - 1];
    assert.equal(last.tick, 150);
    assert.deepEqual(last.log, duel.log);
    assert.equal(Math.floor(D.standings(last).find((x) => x.trader.id === D.DUEL_ME).equity), equity);
    // Old matches without actions still show; bad actions are dropped.
    const bad = await api.matches.start({ game: 'duel', stakeLots: 1, requestId: 'h2' });
    await api.matches.finish(bad.matchId, { place: 3, equity: 100, actions: [{ tick: -1, type: 'open' }, { tick: 5, type: 'open', side: 1, leverage: 7 }, { tick: 6, type: 'close' }] });
    assert.deepEqual((await api.history.get(bad.matchId)).duel.actions, [{ tick: 6, type: 'close' }]);
    assert.equal((await api.history.list()).items.length, 2);
  });

  await t('rate is fixed forever: no route changes a game, publishing again is refused', async () => {
    const raw = new MockTransport(server, () => sim);
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const res = await raw.send({ method, path: '/v1/games/duel', body: { currency: { rate: { abie: 1, units: 1000 } } }, token: globalThis.mainToken });
      assert.equal(res.status, 404);
    }
    const duel = (await api.games.list()).items.find((g) => g.id === 'duel');
    await assert.rejects(server.dev.publishGame({ ...duel, currency: { ...duel.currency, rate: { abie: 1, units: 1000 } } }), /already published/);
    await assert.rejects(server.dev.publishGame({ id: 'bad', universes: 'all', currency: { code: 'B', rate: { abie: 1.5, units: 10 }, settle: 'none' }, publishedAt: 1 }), /whole numbers/);
    assert.deepEqual((await api.games.list()).items.find((g) => g.id === 'duel').currency.rate, { abie: 1, units: 100 });
  });

  await t('universes: a game of another universe cannot be played or bought', async () => {
    await server.dev.publishGame({ id: 'hubquiz', universes: ['ozonik'], currency: { code: 'HQ', rate: { abie: 2, units: 5 }, settle: 'none' }, publishedAt: Date.now() });
    const ids = (await api.games.list()).items.map((g) => g.id);
    assert.deepEqual(ids.sort(), ['duel', 'hubquiz', 'kombat']);
    await expectErr(api.matches.start({ game: 'hubquiz', stakeLots: 1, requestId: 'q1' }), 'forbidden');
    await expectErr(api.games.buyCurrency('hubquiz', 1, 'q1'), 'forbidden');
    await expectErr(api.games.buyCurrency('nope', 1, 'q1'), 'not_found');
  });

  await t('a match never finished is closed by the server: stake back, no fee, not counted', async () => {
    await api.matches.start({ game: 'duel', stakeLots: 10, requestId: 's5' });
    assert.equal((await api.wallet.get()).balance, 83);
    const realNow = server.now;
    server.now = () => realNow() + MATCH_STALE_MS + 1000;
    assert.equal((await api.wallet.get()).balance, 93);
    assert.equal((await api.me.get()).profile.stats.matches, 4);
    server.now = realNow;
    balanceNow = 93;
  });

  await t('wallet: history newest first with pages', async () => {
    const all = [];
    let cursor = null;
    do {
      const page = await api.wallet.transactions(cursor, 3);
      assert.ok(page.items.length <= 3);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(all[0].balanceAfter, balanceNow);
    assert.equal(all.at(-1).kind, 'welcome');
    for (let i = 0; i < all.length - 1; i++) assert.equal(all[i].balanceAfter - all[i].amount, all[i + 1].balanceAfter);
    assert.ok(all.some((x) => x.kind === 'currency_buy') && all.some((x) => x.kind === 'currency_return'));
  });

  await t('logout ends the session; signing in again restores the same account', async () => {
    await api.auth.logout();
    await expectErr(api.me.get(), 'unauthorized');
    api.setToken(null);
    const ch = await api.auth.emailStart('player@example.com');
    const res = await api.auth.emailVerify(ch.challengeId, inbox.at(-1).code);
    assert.equal(res.isNew, false);
    assert.equal(res.account.id, accountId);
    api.setToken(res.session.token);
    assert.equal((await api.wallet.get()).balance, balanceNow);
    assert.equal(res.profile.nickname, 'Bull Run');
  });

  await t('telegram: pending until the bot confirms, then signs in once', async () => {
    const tg = createApi(new MockTransport(server, () => sim));
    const ch = await tg.auth.telegramStart();
    assert.match(ch.botUrl, /^https:\/\/t\.me\/MarketCombatBot\?start=login_/);
    assert.equal((await tg.auth.challenge(ch.challengeId)).status, 'pending');
    await server.dev.telegramConfirm(ch.botUrl, { id: 777, username: 'trader_777' });
    const st = await tg.auth.challenge(ch.challengeId);
    assert.equal(st.status, 'confirmed');
    assert.equal(st.account.identities[0].display, '@trader_777');
    assert.equal((await tg.auth.challenge(ch.challengeId)).status, 'expired');
  });

  await t('phone via Telegram: shared number becomes the identity, masked', async () => {
    const ph = createApi(new MockTransport(server, () => sim));
    const ch = await ph.auth.phoneStart();
    assert.match(ch.botUrl, /start=phone_/);
    await assert.rejects(server.dev.telegramConfirm(ch.botUrl, { id: 5, username: 'x', phone: '12' }));
    await server.dev.telegramConfirm(ch.botUrl, { id: 5, username: 'x', phone: '+7 (912) 345-67-89' });
    const st = await ph.auth.challenge(ch.challengeId);
    assert.equal(st.account.identities[0].subject, '+79123456789');
    assert.equal(st.account.identities[0].display, '+7 ••• ••• 67 89');
  });

  await t('google: stub token accepted, garbage rejected, same Google account = same player', async () => {
    const g = createApi(new MockTransport(server, () => sim));
    await expectErr(g.auth.google('garbage'), 'unauthorized');
    const tok = makeMockGoogleToken({ sub: 'g-1', email: 'a@gmail.com', name: 'A' });
    const a = await g.auth.google(tok);
    const b = await g.auth.google(tok);
    assert.equal(a.isNew, true); assert.equal(b.isNew, false); assert.equal(a.account.id, b.account.id);
  });


  await t('characters: 4 free skins, first choice is free and only once', async () => {
    const c = createApi(new MockTransport(server, () => sim));
    const res = await c.auth.google(makeMockGoogleToken({ sub: 'g-char', email: 'char@gmail.com', name: 'C' }));
    c.setToken(res.session.token);
    assert.deepEqual(res.profile.skins, ['waldberik', 'ozonik', 'avitos', 'yandos']);
    assert.equal(res.profile.character, null);
    await expectErr(c.me.changeGender('f'), 'conflict');
    await expectErr(c.me.chooseCharacter('nope', 'm'), 'invalid_input');
    const p = await c.me.chooseCharacter('ozonik', 'f');
    assert.equal(p.character, 'ozonik'); assert.equal(p.gender, 'f');
    await expectErr(c.me.chooseCharacter('avitos', 'm'), 'conflict');
    assert.equal((await c.wallet.get()).balance, 100);
    globalThis.charApi = c;
  });

  await t('appearance: free, once a week', async () => {
    const c = globalThis.charApi;
    const p1 = await c.me.changeGender('m');
    assert.equal(p1.gender, 'm');
    await expectErr(c.me.changeGender('f'), 'rate_limited');
    const same = await c.me.changeGender('m');
    assert.equal(same.gender, 'm');
    const realNow = server.now;
    server.now = () => realNow() + 7 * 24 * 3600 * 1000 + 1000;
    assert.equal((await c.me.changeGender('f')).gender, 'f');
    server.now = realNow;
  });

  await t('character change: 5000 ABIE, refused when short, charged once per request', async () => {
    const c = globalThis.charApi;
    await expectErr(c.me.changeCharacter('yandos', 'r1'), 'insufficient_funds');
    const me = await c.me.get();
    // top up through the wallet service directly (no earning route that big)
    server.wallet.post(me.account.id, { id: 'test-topup', kind: 'match_reward', amount: 6000 });
    await server.wallet.flush();
    await expectErr(c.me.changeCharacter('ozonik', 'r0'), 'invalid_input');
    const r1 = await c.me.changeCharacter('yandos', 'r2');
    assert.equal(r1.profile.character, 'yandos');
    assert.equal(r1.tx.amount, -5000);
    assert.equal(r1.tx.kind, 'character_change');
    assert.equal(r1.tx.balanceAfter, 1100);
    const again = await c.me.changeCharacter('yandos', 'r2');
    assert.equal(again.tx.id, r1.tx.id);
    assert.equal((await c.wallet.get()).balance, 1100);
    const after = await c.me.get();
    assert.equal(after.profile.gender, 'f');
    assert.equal(after.profile.character, 'yandos');
    assert.ok(await server.dev.walletAudit());
  });

  await t('data survives a restart of the server (same storage)', async () => {
    await new Promise((r) => setTimeout(r, 20));
    server = new MockServer(kv);
    api = createApi(new MockTransport(server, () => sim));
    const ch = await api.auth.emailStart('player@example.com').catch(() => null);
    // previous code was used; sign in by token instead
    api.setToken(null);
    const g = createApi(new MockTransport(server, () => sim));
    const tok = makeMockGoogleToken({ sub: 'g-1', email: 'a@gmail.com', name: 'A' });
    const again = await g.auth.google(tok);
    assert.equal(again.isNew, false);
    assert.ok(await server.dev.walletAudit());
  });

  await t('network failures surface as network errors', async () => {
    const flaky = createApi(new MockTransport(server, () => ({ latency: false, failures: true })));
    let net = 0;
    for (let i = 0; i < 200; i++) { try { await flaky.auth.challenge('nope'); } catch (e) { if (e.code === 'network') net++; } }
    assert.ok(net > 5 && net < 50, 'network failures: ' + net);
  });

  await t('reset wipes everything', async () => {
    await server.dev.reset();
    const fresh = new MockServer(kv);
    const g = createApi(new MockTransport(fresh, () => sim));
    const tok = makeMockGoogleToken({ sub: 'g-1', email: 'a@gmail.com', name: 'A' });
    assert.equal((await g.auth.google(tok)).isNew, true);
  });

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
