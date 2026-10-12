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

  await t('matches: reward once per match, stats updated', async () => {
    const m = await api.matches.start({ game: 'duel' });
    assert.ok(Number.isInteger(m.seed));
    await expectErr(api.matches.finish(m.matchId, { place: 9, actions: [] }), 'invalid_input');
    const r1 = await api.matches.finish(m.matchId, { place: 1, actions: [] });
    const r2 = await api.matches.finish(m.matchId, { place: 1, actions: [] });
    assert.equal(r1.reward, 50);
    assert.deepEqual(r1, r2);
    assert.equal((await api.wallet.get()).balance, 150);
    const me = await api.me.get();
    assert.deepEqual(me.profile.stats, { matches: 1, wins: 1, earned: 50 });
  });

  await t('wallet: history newest first with pages', async () => {
    for (let i = 0; i < 4; i++) { const m = await api.matches.start({ game: 'duel' }); await api.matches.finish(m.matchId, { place: 4, actions: [] }); }
    const p1 = await api.wallet.transactions(null, 3);
    assert.equal(p1.items.length, 3);
    assert.equal(p1.items[0].kind, 'match_reward');
    assert.ok(p1.nextCursor);
    const p2 = await api.wallet.transactions(p1.nextCursor, 3);
    assert.equal(p2.items.length, 3);
    assert.equal(p2.items.at(-1).kind, 'welcome');
    assert.equal(p2.nextCursor, null);
    assert.equal(p1.items[0].balanceAfter, 170);
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
    assert.equal((await api.wallet.get()).balance, 170);
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
    assert.deepEqual(res.profile.skins, ['valdberik', 'ozonik', 'avitos', 'yandos']);
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
