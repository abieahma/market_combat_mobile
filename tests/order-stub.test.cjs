// Order Picking: the rules of a shift, the computer pickers, and shifts on the
// server stub: training, rooms with stakes in boxes, settling, history.
const assert = require('node:assert/strict');
const { MemoryKV } = require('../.stub-build/mock-server/db.js');
const { MockServer, makeMockGoogleToken } = require('../.stub-build/mock-server/server.js');
const { MockTransport } = require('../.stub-build/mock-server/transport.js');
const { createApi } = require('../.stub-build/api/client.js');
const { ApiError } = require('../.stub-build/api/transport.js');
const O = require('../.stub-build/game/order.js');
const { ORDER_ROOM_MS, ORDER_GRACE_MS } = require('../.stub-build/mock-server/order.js');

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const expectErr = async (p, code) => { try { await p; assert.fail('expected ' + code); } catch (e) { assert.ok(e instanceof ApiError, String(e)); assert.equal(e.code, code); } };

/** A quick and careful picker: the best actions with `gap` ms between them. Returns the actions and the state. */
function playWell(shift, slot, gap = 60, until = O.ORDER_SHIFT_MS) {
  let st = O.createOrder(shift, slot);
  const actions = [];
  let t = 0;
  for (let guard = 0; guard < 400 && !st.finished; guard++) {
    t = Math.max(t, st.time) + gap;
    if (t >= until) break;
    let a = null;
    const h = st.hand;
    if (h && h.kind === 'item') a = { t, type: 'gofra', n: st.items[h.id].gofra };
    else if (h && h.kind === 'gofra') a = { t, type: 'sign', pos: O.signOf(shift, h.n) };
    else {
      const full = O.fullGofras(st);
      const box = O.inBox(st, t);
      if (full.length) a = { t, type: 'gofra', n: full[0] };
      else if (box.length) a = { t, type: 'take', item: box[box.length - 1].id };
      else {
        const next = st.items.filter((it) => !st.taken[it.id]).map((it) => it.at);
        if (!next.length) break;
        t = Math.max(t, Math.min(...next) - gap);
        continue;
      }
    }
    const res = O.applyOrder(st, a, shift);
    assert.notEqual(res.outcome, 'refused', JSON.stringify(a));
    actions.push(a);
    st = res.state;
  }
  return { actions, state: O.finishOrder(st, until) };
}

(async () => {
  // ------------------------------------------------------------ rules
  await t('order rules: a shift follows from its seed; 8 flows of 8–10 goods, 3–4 gofras fill up, never the same gofra twice in a row', () => {
    assert.deepEqual(O.makeShift(42), O.makeShift(42));
    assert.notDeepEqual(O.makeShift(42).flows[0], O.makeShift(43).flows[0]);
    for (let seed = 1; seed <= 400; seed++) {
      const sh = O.makeShift(seed * 7919);
      assert.equal(sh.flows.length, O.ORDER_PLAYERS);
      assert.deepEqual([...sh.presorts].sort(), [...O.ORDER_PRESORTS].sort());
      assert.deepEqual([...sh.signs].sort(), [...O.ORDER_PRESORTS].sort());
      for (const flow of sh.flows) {
        assert.ok(flow.length >= 8 && flow.length <= 10, `${flow.length} goods`);
        const per = {};
        for (const it of flow) per[it.gofra] = (per[it.gofra] || 0) + 1;
        const fills = Object.values(per).filter((c) => c === O.ORDER_CAP).length;
        assert.ok(fills >= 3 && fills <= 4, `${fills} gofras fill`);
        assert.ok(Object.values(per).every((c) => c <= O.ORDER_CAP));
        assert.ok(flow.every((it, i) => i === 0 || it.gofra !== flow[i - 1].gofra), 'a gofra twice in a row');
        assert.ok(flow.every((it, i) => (i < 3 ? it.at === 0 : it.at - flow[i - 1].at >= 2000 && it.at - flow[i - 1].at <= 3500)));
        assert.ok(flow.every((it) => it.gofra >= 1 && it.gofra <= O.ORDER_GOFRAS && Number.isInteger(it.at)));
      }
    }
  });

  await t('order rules: the floor: every gofra, pre-sort and the box can be reached; the island is in the middle', () => {
    for (let n = 1; n <= O.ORDER_GOFRAS; n++) {
      const p = O.shortestPath(O.ORDER_START, O.gofraSpots(n));
      assert.equal(p[p.length - 1], O.gofraSpots(n)[0]);
    }
    for (let pos = 0; pos < O.ORDER_SIGNS.length; pos++) {
      const p = O.shortestPath(O.ORDER_START, O.signSpots(pos));
      assert.ok(O.signSpots(pos).includes(p[p.length - 1]));
    }
    assert.deepEqual(O.gofraCell(1), [4, 2]);
    assert.deepEqual(O.gofraCell(8), [4, 9]);
    assert.deepEqual(O.gofraCell(9), [5, 2]);
    assert.deepEqual(O.gofraCell(16), [5, 9]);
  });

  await t('order rules: take, put, lift, deliver; mistakes cost 10; everything done early gives the seconds left', () => {
    const sh = O.makeShift(2024);
    let st = O.createOrder(sh, 0);
    const first = O.inBox(st, 0)[1];
    // A good that has not come yet cannot be taken.
    const later = st.items.find((it) => it.at > 0);
    assert.equal(O.applyOrder(st, { t: 0, type: 'take', item: later.id }, sh).outcome, 'refused');
    let r = O.applyOrder(st, { t: 100, type: 'take', item: first.id }, sh);
    assert.equal(r.outcome, 'took');
    st = r.state;
    assert.ok(st.time >= 100 && st.hand.id === first.id);
    // An action while the picker is still walking starts when they are free.
    const wrong = (first.gofra % O.ORDER_GOFRAS) + 1;
    r = O.applyOrder(st, { t: 120, type: 'gofra', n: wrong }, sh);
    assert.equal(r.outcome, 'wrongGofra');
    assert.equal(r.state.walks[r.state.walks.length - 1].from, Math.max(120, st.time));
    st = r.state;
    assert.deepEqual([st.mistakes, st.hand.id], [1, first.id]);
    assert.equal(O.applyOrder(st, { t: st.time, type: 'scan' }, sh).outcome, 'scanned');
    st = O.applyOrder(st, { t: st.time, type: 'gofra', n: first.gofra }, sh).state;
    assert.deepEqual([st.correct, st.fill[first.gofra], st.hand], [1, 1, null]);
    assert.equal(O.pointsAt(st, st.time), 0);

    const best = playWell(sh, 0);
    const score = O.orderScore(best.state);
    const goods = sh.flows[0].length;
    const fills = new Set(sh.flows[0].filter((it, _, a) => a.filter((x) => x.gofra === it.gofra).length === O.ORDER_CAP).map((it) => it.gofra)).size;
    assert.ok(best.state.early, 'everything done before the bell');
    assert.deepEqual([score.correct, score.sent, score.mistakes, score.missed], [goods, fills, 0, 0]);
    assert.equal(score.bonus, Math.floor((O.ORDER_SHIFT_MS - best.state.finishedAt) / 1000));
    assert.equal(score.total, goods * 10 + fills * 10 + score.bonus);
    // The server plays the actions again and gets the same.
    assert.deepEqual(O.orderScore(O.replayOrder(sh, 0, best.actions)), score);
  });

  await t('order rules: a gofra to a wrong pre-sort costs 10; what is left at the bell costs 10 each', () => {
    const sh = O.makeShift(77);
    const busy = sh.flows[0].find((it, _, a) => a.filter((x) => x.gofra === it.gofra).length === 2).gofra;
    const two = sh.flows[0].filter((it) => it.gofra === busy);
    let st = O.createOrder(sh, 0);
    const step = (a) => { const r = O.applyOrder(st, { ...a, t: Math.max(a.t ?? 0, st.time) }, sh); st = r.state; return r.outcome; };
    for (const it of two) {
      assert.equal(step({ t: it.at, type: 'take', item: it.id }), 'took');
      assert.ok(['dropped', 'filled'].includes(step({ type: 'gofra', n: busy })));
    }
    assert.deepEqual(O.fullGofras(st), [busy]);
    assert.equal(step({ type: 'gofra', n: busy }), 'lifted');
    assert.deepEqual(O.fullGofras(st), []);
    const right = O.signOf(sh, busy);
    assert.equal(step({ type: 'sign', pos: (right + 1) % 16 }), 'wrongSign');
    assert.equal(step({ type: 'sign', pos: right }), 'delivered');
    assert.deepEqual([st.fill[busy], st.sent, st.hand, st.mistakes], [0, [busy], null, 1]);
    const end = O.finishOrder(st);
    const score = O.orderScore(end);
    const left = sh.flows[0].length - 2;
    assert.deepEqual([score.correct, score.sent, score.mistakes, score.missed, score.bonus], [2, 1, 1, left, 0]);
    assert.equal(score.total, 20 + 10 - 10 - left * 10);
    // An action after the bell changes nothing.
    assert.equal(O.applyOrder(O.createOrder(sh, 0), { t: O.ORDER_SHIFT_MS, type: 'take', item: 0 }, sh).outcome, 'late');
  });

  await t('order rules: the computer pickers play the same shift the same way, and well enough', () => {
    const sh = O.makeShift(555);
    for (let slot = 1; slot < O.ORDER_PLAYERS; slot++) {
      const a = O.playBot(sh, slot);
      assert.deepEqual(a, O.playBot(sh, slot));
      assert.deepEqual(O.orderScore(O.replayOrder(sh, slot, a.actions)), O.orderScore(a.state));
      assert.ok(a.state.correct >= sh.flows[slot].length - 2, `slot ${slot} put away ${a.state.correct}`);
    }
    const w = O.pickerAt(O.playBot(sh, 1).state.walks, 1500);
    assert.ok(w.r >= 0 && w.r < O.ORDER_ROWS && w.c >= 0 && w.c < O.ORDER_COLS);
  });

  // ------------------------------------------------------------ server
  const kv = new MemoryKV();
  const server = new MockServer(kv);
  const realNow = server.now;
  let clock = Date.UTC(2026, 10, 1, 12);
  server.now = () => clock;
  const sim = { latency: false, failures: false };
  const player = async (name, character = 'waldberik') => {
    const api = createApi(new MockTransport(server, () => sim));
    const res = await api.auth.google(makeMockGoogleToken({ sub: 'g-' + name, email: name + '@gmail.com', name }));
    api.setToken(res.session.token);
    if (character) await api.me.chooseCharacter(character, 'm');
    api.id = res.account.id;
    return api;
  };
  const balance = async (api) => (await api.wallet.get()).balance;
  const shiftOf = (v) => O.makeShift(v.seed);

  await t('order: the game is in the registry for every universe; boxes cost 10 ABIE each', async () => {
    const a = await player('o-reg');
    const g = (await a.games.list()).items.find((x) => x.id === 'order');
    assert.deepEqual([g.universes, g.currency], ['all', { code: 'BOX', rate: { abie: 10, units: 100 }, settle: 'match' }]);
    const none = await player('o-none', null);
    await expectErr(none.order.start('training', undefined, 'n1'), 'conflict');
  });

  await t('order training: free; seven computer pickers; the server counts the score itself; history', async () => {
    const a = await player('o-train');
    const b0 = await balance(a);
    const v = await a.order.start('training', undefined, 'tr1');
    assert.equal((await a.order.start('training', undefined, 'tr1')).id, v.id);
    assert.deepEqual([v.mode, v.status, v.slot, v.stake, v.rivals.length, v.score], ['training', 'playing', 0, 0, 7, null]);
    assert.ok(v.rivals.every((r) => r.isBot && r.score === null));
    const sh = shiftOf(v);
    const best = playWell(sh, 0);
    // Actions from the future of the shift are refused.
    await expectErr(a.order.finish(v.id, best.actions, best.state.finishedAt), 'invalid_input');
    clock += 61_000;
    await expectErr(a.order.finish(v.id, [{ t: 5, type: 'take', item: 0 }, { t: 1, type: 'scan' }], 60_000), 'invalid_input');
    // A score made up by the app does not exist: only actions are sent.
    const done = await a.order.finish(v.id, best.actions, best.state.finishedAt);
    assert.deepEqual(done.score, O.orderScore(best.state));
    assert.equal(done.status, 'settled');
    assert.ok(done.rivals.every((r) => r.score && r.finished));
    const all = [done.score, ...done.rivals.map((r) => r.score)].map((s) => s.total);
    assert.equal(done.place, 1 + all.slice(1).filter((x) => x > all[0]).length);
    assert.deepEqual(await a.order.finish(v.id, [], 0), done);
    assert.equal(await balance(a), b0);
    const page = await a.history.list('order');
    assert.equal(page.items.length, 1);
    assert.deepEqual([page.items[0].game, page.items[0].mode, page.items[0].players, page.items[0].net, page.items[0].place], ['order', 'bot', 8, 0, done.place]);
    const detail = await a.history.get(v.id);
    assert.deepEqual(detail.order.actions, best.actions);
    assert.equal((await a.me.get()).profile.stats.matches, 0);
  });

  await t('order stakes: one room for the same stake; the best takes the bank, the platform 10% of the others', async () => {
    const a = await player('o-a');
    const b = await player('o-b', 'ozonik');
    const c = await player('o-c', 'avitos');
    const [a0, b0, c0] = [await balance(a), await balance(b), await balance(c)];
    const platform0 = server.wallet.balance('platform');
    const va = await a.order.start('stake', 2, 'sa');
    const vb = await b.order.start('stake', 2, 'sb');
    const other = await c.order.start('stake', 1, 'sc');
    assert.notEqual(other.seed, va.seed);
    assert.deepEqual([va.seed === vb.seed, va.slot, vb.slot, va.stake, va.stakeLots], [true, 0, 1, 200, 2]);
    assert.equal(await balance(a), a0 - 20);
    assert.equal(va.tx.amount, -20);
    const sh = shiftOf(va);
    const wa = playWell(sh, 0, 40);
    const wb = playWell(sh, 1, 400);
    clock += 61_000;
    const da = await a.order.finish(va.id, wa.actions, wa.state.finishedAt);
    assert.equal(da.status, 'waiting');
    const db = await b.order.finish(vb.id, wb.actions, wb.state.finishedAt);
    // b sees a's shift to play it back on the floor.
    assert.deepEqual(db.rivals.find((r) => r.slot === 0).actions, wa.actions);
    assert.equal(db.status, 'waiting');
    // The room closes when its time is up.
    clock += ORDER_ROOM_MS;
    const fa = await a.order.get(va.id);
    const fb = await b.order.get(vb.id);
    assert.deepEqual([fa.status, fb.status], ['settled', 'settled']);
    const [win, lose, wApi, lApi, w0, l0] = fa.score.total >= fb.score.total ? [fa, fb, a, b, a0, b0] : [fb, fa, b, a, b0, a0];
    if (fa.score.total !== fb.score.total || fa.score.mistakes !== fb.score.mistakes) {
      // Bank 2 × 20 ABIE: the winner gets their 20 and 18 of the other's 20; the platform keeps 2.
      assert.deepEqual([win.settlement.place, win.settlement.back, win.settlement.payout, win.settlement.net, win.settlement.fee], [1, 380, 38, 18, 20]);
      assert.deepEqual([lose.settlement.place, lose.settlement.payout, lose.settlement.net], [2, 0, -20]);
      assert.equal(await balance(wApi), w0 + 18);
      assert.equal(await balance(lApi), l0 - 20);
    }
    // c was alone in the room: the stake comes back.
    const fc = await c.order.get(other.id);
    assert.equal(fc.status, 'abandoned');
    clock += 1;
    assert.equal((await c.order.get(other.id)).settlement.refunded, true);
    assert.equal(await balance(c), c0);
    assert.equal(server.wallet.balance('platform') - platform0, 2);
    assert.ok(await server.dev.walletAudit());
    const stats = (await wApi.me.get()).profile.stats;
    assert.deepEqual([stats.matches, stats.wins, stats.earned], [1, 1, 18]);
    const hist = (await wApi.history.list('order')).items[0];
    assert.deepEqual([hist.mode, hist.outcome, hist.players, hist.net], ['pvp', 'win', 2, 18]);
  });

  await t('order stakes: with the test players of the developer panel the room fills at once and settles when the player is done', async () => {
    server.devSettings.sparring = true;
    const a = await player('o-spar');
    const a0 = await balance(a);
    const v = await a.order.start('stake', 1, 'sp1');
    assert.equal(v.rivals.length, 7);
    assert.ok(v.rivals.every((r) => r.finished && r.actions && r.score));
    const w = playWell(shiftOf(v), 0, 30);
    clock += 61_000;
    const done = await a.order.finish(v.id, w.actions, w.state.finishedAt);
    assert.equal(done.status, 'settled');
    const s = done.settlement;
    assert.equal(s.players, 8);
    if (s.place === 1 && s.winners === 1) assert.deepEqual([s.payout, s.net], [73, 63]);
    assert.equal(await balance(a), a0 + s.net);
    assert.ok(await server.dev.walletAudit());
    server.devSettings.sparring = false;
  });

  await t('order: a shift never finished is closed by the server as it stands; a new shift closes the old one', async () => {
    const a = await player('o-stale');
    const v = await a.order.start('training', undefined, 'st1');
    const v2 = await a.order.start('training', undefined, 'st2');
    assert.equal((await a.order.get(v.id)).status, 'abandoned');
    clock += 60_000 + ORDER_GRACE_MS + 1;
    const g = await a.order.get(v2.id);
    assert.equal(g.status, 'abandoned');
    assert.equal(g.score.correct, 0);
    assert.ok(g.score.missed >= 8);
    const items = (await a.history.list('order')).items;
    assert.deepEqual(items.map((i) => i.outcome), ['abandoned', 'abandoned']);
  });

  server.now = realNow;
  console.log(`\n${passed} passed`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
