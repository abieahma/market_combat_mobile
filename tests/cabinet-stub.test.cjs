// Cabinets: country fixed at registration, the price of ABIE, leaving and
// coming back to a universe, changing universes, one identifier per cabinet.
const assert = require('node:assert/strict');
const { MemoryKV } = require('../.stub-build/mock-server/db.js');
const { MockServer, makeMockGoogleToken } = require('../.stub-build/mock-server/server.js');
const { MockTransport } = require('../.stub-build/mock-server/transport.js');
const { createApi } = require('../.stub-build/api/client.js');
const { ApiError } = require('../.stub-build/api/transport.js');
const C = require('../.stub-build/wallet/countries.js');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const expectErr = async (p, code) => { try { await p; assert.fail('expected ' + code); } catch (e) { assert.ok(e instanceof ApiError, String(e)); assert.equal(e.code, code); } };

(async () => {
  const kv = new MemoryKV();
  let server = new MockServer(kv);
  const sim = { latency: false, failures: false };
  const client = (region) => { const api = createApi(new MockTransport(server, () => sim)); api.setRegion(region); return api; };
  const google = async (name, region) => {
    const api = client(region);
    const res = await api.auth.google(makeMockGoogleToken({ sub: 'g-' + name, email: name + '@gmail.com', name }));
    api.setToken(res.session.token);
    api.id = res.account.id;
    return api;
  };
  const viaBot = async (kind, user, region) => {
    const api = client(region);
    const ch = kind === 'phone' ? await api.auth.phoneStart() : await api.auth.telegramStart();
    await server.dev.telegramConfirm(ch.botUrl, user);
    const st = await api.auth.challenge(ch.challengeId);
    if (st.status === 'confirmed') { api.setToken(st.session.token); api.id = st.account.id; api.account = st.account; }
    api.status = st;
    return api;
  };

  await t('countries: phone numbers map to countries, +7 splits Russia and Kazakhstan', () => {
    assert.equal(C.countryOfPhone('+79123456789'), 'RU');
    assert.equal(C.countryOfPhone('+77011234567'), 'KZ');
    assert.equal(C.countryOfPhone('+380501234567'), 'UA');
    assert.equal(C.countryOfPhone('+998901234567'), 'UZ');
    assert.equal(C.countryOfPhone('+12025550123'), 'US');
    assert.equal(C.countryOfPhone('+4930123456'), null);
  });

  await t('country: fixed at registration (phone first, else the device region) and never changed', async () => {
    const a = await google('rus', 'RU');
    assert.deepEqual([(await a.me.get()).profile.country.code, (await a.me.get()).profile.country.source], ['RU', 'device']);
    const again = await google('rus', 'KZ');
    assert.equal((await again.me.get()).profile.country.code, 'RU', 'the country does not follow the device');
    const kz = await viaBot('phone', { id: 501, username: 'kz', phone: '+7 701 123 45 67' }, 'RU');
    const p = (await kz.me.get()).profile;
    assert.deepEqual([p.country.code, p.country.currency, p.country.source], ['KZ', 'KZT', 'phone']);
    globalThis.kz = kz; globalThis.ru = a;
  });

  await t('ABIE price: 1 unit of the home money; disagreeing signals get the most expensive money', async () => {
    const kz = globalThis.kz;
    assert.deepEqual(await kz.wallet.quote({ abie: 100 }), { currency: 'KZT', price: 100, mismatch: false, considered: ['KZ'], home: 'KZ' });
    const rubCard = await kz.wallet.quote({ abie: 100, payment: 'RU' });
    assert.deepEqual([rubCard.currency, rubCard.price, rubCard.mismatch], ['RUB', 100, true]);
    const vpn = await kz.wallet.quote({ abie: 100, vpn: true });
    assert.deepEqual([vpn.currency, vpn.mismatch], ['USD', true]);
    const ru = globalThis.ru;
    const kztCard = await ru.wallet.quote({ abie: 1800, payment: 'KZ' });
    assert.deepEqual([kztCard.currency, kztCard.price], ['RUB', 1800], 'a cheaper card does not make ABIE cheaper');
    await expectErr(ru.wallet.quote({ abie: 0 }), 'invalid_input');
  });

  await t('universe: leaving is free, coming back costs 50 ABIE once per key; outside no game can be played', async () => {
    const a = globalThis.ru;
    await expectErr(a.me.leaveUniverse(), 'conflict');
    await a.me.chooseCharacter('avitos', 'f');
    const m = await a.matches.start({ game: 'duel', stakeLots: 10, requestId: 'm1' });
    await a.matches.finish(m.matchId, { place: 1, equity: 1300, actions: [] });
    const before = (await a.me.get()).profile.stats;
    const out = await a.me.leaveUniverse();
    assert.deepEqual([out.inUniverse, out.character], [false, 'avitos']);
    const bal = (await a.wallet.get()).balance;
    await expectErr(a.matches.start({ game: 'duel', stakeLots: 10, requestId: 'm2' }), 'conflict');
    const back = await a.me.returnUniverse('r1');
    const backAgain = await a.me.returnUniverse('r1');
    assert.deepEqual([back.tx.kind, back.tx.amount, back.profile.inUniverse], ['universe_return', -50, true]);
    assert.equal(backAgain.tx.id, back.tx.id);
    assert.equal((await a.wallet.get()).balance, bal - 50);
    await expectErr(a.me.returnUniverse('r2'), 'conflict');
    assert.deepEqual((await a.me.get()).profile.stats, before);
  });

  await t('universe: moving to another universe costs 5000 ABIE, works from outside, keeps ratings', async () => {
    const a = globalThis.ru;
    const stats = (await a.me.get()).profile.stats;
    await a.me.leaveUniverse();
    await expectErr(a.me.changeCharacter('yandos', 'c1'), 'insufficient_funds');
    const g = await server.dev.grant(a.id, 6000);
    assert.equal(g.kind, 'test_grant');
    const r = await a.me.changeCharacter('yandos', 'c2');
    assert.deepEqual([r.profile.character, r.profile.inUniverse, r.tx.amount], ['yandos', true, -5000]);
    assert.deepEqual(r.profile.stats, stats);
    assert.ok(await server.dev.walletAudit());
  });

  await t('one identifier, one cabinet: the bot merges a new phone into the Telegram cabinet, refuses two cabinets', async () => {
    const tg = await viaBot('telegram', { id: 900, username: 'one' }, 'RU');
    const withPhone = await viaBot('phone', { id: 900, username: 'one', phone: '+7 912 000 00 01' }, 'RU');
    assert.equal(withPhone.id, tg.id, 'the same person, the same cabinet');
    assert.deepEqual(withPhone.account.identities.map((i) => i.provider).sort(), ['phone', 'telegram']);
    const other = await viaBot('phone', { id: 901, username: 'two', phone: '+7 912 000 00 02' }, 'RU');
    assert.notEqual(other.id, tg.id);
    const mixed = await viaBot('phone', { id: 900, username: 'one', phone: '+7 912 000 00 02' }, 'RU');
    assert.deepEqual(mixed.status, { status: 'refused', code: 'identity_conflict' });
  });

  await t('registry: the platform\'s own duel moves to the player\'s money; author games are never touched', async () => {
    const games = server.db.table('games');
    games.put('duel', { ...games.get('duel'), currency: { code: 'DUSD', rate: { abie: 1, units: 100 }, settle: 'match' }, revision: 1 });
    await server.dev.publishGame({ id: 'author1', universes: 'all', currency: { code: 'AU', rate: { abie: 2, units: 3 }, settle: 'none' }, entry: { kind: 'free' }, author: { accountId: 'x', nickname: 'x' }, authorShare: 5, publishedAt: 1 });
    await server.db.flush();
    server = new MockServer(kv);
    const a = createApi(new MockTransport(server, () => sim));
    const res = await a.auth.google(makeMockGoogleToken({ sub: 'g-reg', email: 'reg@gmail.com', name: 'r' }));
    a.setToken(res.session.token);
    const items = (await a.games.list()).items;
    assert.equal(items.find((g) => g.id === 'duel').currency.code, 'LOCAL');
    assert.deepEqual(items.find((g) => g.id === 'author1').currency.rate, { abie: 2, units: 3 });
  });

  console.log(`\n${passed} passed`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
