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
  const R = require('../.stub-build/game/rng.js');
  /** A seed whose first turn rolls no crit for either fighter. */
  const calmSeed = (from = 1) => {
    for (let seed = from; ; seed++) {
      const [x, s1] = R.nextFloat(seed >>> 0);
      const [y] = R.nextFloat(s1);
      if (x >= K.KOMBAT_CRIT_CHANCE && y >= K.KOMBAT_CRIT_CHANCE) return seed;
    }
  };
  /** A fight with chosen hands and energy. */
  const setup = (seed, chars, hands, energy = 60) => {
    const s = K.createKombat(seed, { character: chars[0] }, { character: chars[1] });
    for (const i of [0, 1]) s.fighters[i] = { ...s.fighters[i], hand: hands[i], energy };
    return s;
  };
  const card = (c, as) => (as ? { kind: 'card', card: c, as } : { kind: 'card', card: c });
  const rest = { kind: 'rest' };

  await t('kombat rules: 53 cards, four suits of 13 and a joker; each fighter its own deck by the seed', () => {
    assert.equal(K.DECK.length, 53);
    assert.equal(new Set(K.DECK).size, 53);
    for (const suit of ['waldberik', 'ozonik', 'avitos', 'yandos']) assert.equal(K.DECK.filter((c) => c.startsWith(suit + '-')).length, 13);
    const s = K.createKombat(42, { character: 'waldberik' }, { character: 'avitos' });
    for (const f of s.fighters) {
      assert.equal(f.hand.length, K.KOMBAT_HAND);
      assert.equal(f.deck.length, 53 - K.KOMBAT_HAND);
      assert.deepEqual([...f.hand, ...f.deck].sort(), [...K.DECK].sort());
    }
    assert.notDeepEqual(s.fighters[0].hand.concat(s.fighters[0].deck), s.fighters[1].hand.concat(s.fighters[1].deck));
    assert.deepEqual(K.createKombat(42, { character: 'ozonik' }, { character: 'yandos' }).fighters[0].hand, s.fighters[0].hand);
  });

  await t('kombat rules: the same seed and plays give the same fight', () => {
    const play = () => {
      let s = K.createKombat(42, { character: 'waldberik' }, { character: 'avitos' });
      while (!s.finished) {
        const a = K.botPlay(s, 0);
        const b = K.botPlay(a.state, 1);
        s = K.resolveTurn(b.state, [a.play, b.play], 1000 + s.turn);
      }
      return s;
    };
    const one = play();
    assert.deepEqual(one, play());
    assert.ok(one.log.every((turn) => turn.sides.every((x) => x.hp !== undefined && x.energy !== undefined)), 'every turn keeps a snapshot');
  });

  await t('kombat rules: a played card is paid, replaced from the deck, and a defence absorbs by its rank', () => {
    const s0 = setup(calmSeed(), ['waldberik', 'ozonik'], [['avitos-8', 'yandos-2', 'yandos-3', 'yandos-4', 'yandos-5'], ['ozonik-7', 'avitos-2', 'avitos-3', 'avitos-4', 'avitos-5']]);
    const top = s0.fighters[0].deck[0];
    const s = K.resolveTurn(s0, [card('avitos-8'), card('ozonik-7')]);
    const [a, b] = s.log[0].sides;
    assert.deepEqual([a.attack, a.crit, a.cost], [15, false, 15]);
    // Own suit: the 7 of the ozonik suit absorbs 14 × 1.25 = 18 for Ozonik.
    assert.deepEqual([b.absorbed, a.dealt, b.taken, b.hp], [15, 0, 0, 100]);
    assert.equal(s.fighters[0].energy, 60 - 15 + K.KOMBAT_REGEN);
    assert.ok(!s.fighters[0].hand.includes('avitos-8'));
    assert.ok(s.fighters[0].hand.includes(top));
    assert.equal(s.fighters[0].hand.length, 5);
  });

  await t('kombat rules: own suit hits 25% harder; two cards of a suit in a row add a combo level', () => {
    const seed = calmSeed();
    const own = K.resolveTurn(setup(seed, ['waldberik', 'ozonik'], [['waldberik-10', 'x', 'x', 'x', 'x'], ['avitos-2', 'x', 'x', 'x', 'x']]), [card('waldberik-10'), rest]);
    assert.deepEqual([own.log[0].sides[0].attack, own.log[0].sides[0].ownSuit], [23, true]);
    const other = K.resolveTurn(setup(seed, ['yandos', 'ozonik'], [['waldberik-10', 'x', 'x', 'x', 'x'], ['avitos-2', 'x', 'x', 'x', 'x']]), [card('waldberik-10'), rest]);
    assert.equal(other.log[0].sides[0].attack, 18);
    // Turn 1 a defence of the avitos suit, turn 2 an attack of the same suit: +1 combo, +25%.
    let s = setup(calmSeed(), ['waldberik', 'ozonik'], [['avitos-3', 'avitos-4', 'x', 'x', 'x'], ['ozonik-3', 'ozonik-5', 'x', 'x', 'x']]);
    s = K.resolveTurn(s, [card('avitos-3'), card('ozonik-3')]);
    assert.equal(s.fighters[0].lastSuit, 'avitos');
    s = K.resolveTurn(s, [card('avitos-4'), rest]);
    const turn2 = s.log[1].sides[0];
    assert.equal(turn2.chain, true);
    assert.equal(turn2.comboUsed, 1);
    assert.ok(turn2.attack === 11 || turn2.attack === 17, `9 × 1.25 = 11 (or a crit), got ${turn2.attack}`);
    assert.equal(s.fighters[0].combo, 0, 'the attack spent the combo');
  });

  await t('kombat rules: the joker becomes the card the fighter names', () => {
    const s0 = setup(calmSeed(), ['waldberik', 'ozonik'], [['joker', 'x', 'x', 'x', 'x'], ['avitos-2', 'x', 'x', 'x', 'x']], 50);
    assert.equal(K.playProblem(s0.fighters[0], card('joker')), 'joker');
    assert.equal(K.playProblem(s0.fighters[0], card('joker', 'joker')), 'joker');
    assert.equal(K.playProblem({ ...s0.fighters[0], energy: 30 }, card('joker', 'waldberik-A')), 'energy');
    const s = K.resolveTurn(s0, [card('joker', 'waldberik-A'), rest]);
    const a = s.log[0].sides[0];
    assert.deepEqual([a.play.card, a.play.as, a.card, a.cost, a.attack], ['joker', 'waldberik-A', 'waldberik-A', 40, 38]);
    assert.ok(!s.fighters[0].hand.includes('joker'));
  });

  await t('kombat rules: a hit while boosting a combo (J) breaks it; without a hit the J adds 2', () => {
    const seed = calmSeed();
    const hit = K.resolveTurn(setup(seed, ['waldberik', 'ozonik'], [['avitos-6', 'x', 'x', 'x', 'x'], ['yandos-J', 'x', 'x', 'x', 'x']]), [card('avitos-6'), card('yandos-J')]);
    assert.deepEqual([hit.log[0].sides[1].caught, hit.fighters[1].combo, hit.log[0].sides[0].attack], [true, 0, 15]);
    const calm = K.resolveTurn(setup(seed, ['waldberik', 'ozonik'], [['avitos-3', 'x', 'x', 'x', 'x'], ['yandos-J', 'x', 'x', 'x', 'x']]), [card('avitos-3'), card('yandos-J')]);
    assert.equal(calm.fighters[1].combo, K.KOMBAT_BOOST_COMBO);
  });

  await t('kombat rules: tricks of the kings work when the hit gets through', () => {
    // Waldberik's king stuns: the opponent skips the next turn, and is not stunned twice in a row.
    let s = setup(calmSeed(), ['waldberik', 'ozonik'], [['waldberik-K', 'waldberik-2', 'x', 'x', 'x'], ['avitos-2', 'avitos-4', 'x', 'x', 'x']]);
    s = K.resolveTurn(s, [card('waldberik-K'), card('avitos-2')]);
    assert.ok(s.fighters[1].effects.some((e) => e.kind === 'stun'));
    s = K.resolveTurn(s, [card('waldberik-2'), card('avitos-4')]);
    assert.equal(s.log[1].sides[1].play.kind, 'stunned');
    assert.ok(s.fighters[1].hand.includes('avitos-4'), 'a skipped turn keeps the card');
    assert.ok(!s.fighters[1].effects.some((e) => e.kind === 'stun'));
    // Blocked: no stun.
    const blocked = K.resolveTurn(setup(calmSeed(), ['waldberik', 'ozonik'], [['waldberik-K', 'x', 'x', 'x', 'x'], ['ozonik-9', 'x', 'x', 'x', 'x']]), [card('waldberik-K'), card('ozonik-9')]);
    assert.ok(!blocked.fighters[1].effects.some((e) => e.kind === 'stun'));
    assert.ok(blocked.log[0].sides[1].counter > 0, 'the 9 hits back');
    // Ozonik's king poisons for three turns, through any defence.
    let p = setup(calmSeed(), ['ozonik', 'avitos'], [['ozonik-K', 'x', 'x', 'x', 'x'], ['avitos-2', 'x', 'x', 'x', 'x']]);
    p = K.resolveTurn(p, [card('ozonik-K'), rest]);
    p = K.resolveTurn(p, [rest, rest]);
    p = K.resolveTurn(p, [rest, rest]);
    p = K.resolveTurn(p, [rest, rest]);
    assert.deepEqual(p.log.map((x) => x.sides[1].poison), [6, 6, 6, 0]);
    // Avitos's king takes energy.
    const st = K.resolveTurn(setup(calmSeed(), ['avitos', 'yandos'], [['avitos-K', 'x', 'x', 'x', 'x'], ['ozonik-2', 'x', 'x', 'x', 'x']]), [card('avitos-K'), rest]);
    assert.equal(st.log[0].sides[0].stole, 25);
    assert.equal(st.fighters[1].energy, 60 - 25 + K.KOMBAT_REGEN + K.KOMBAT_REST_ENERGY);
    // Yandos's king goes around a defence.
    const pierce = K.resolveTurn(setup(calmSeed(), ['yandos', 'ozonik'], [['yandos-K', 'x', 'x', 'x', 'x'], ['ozonik-9', 'x', 'x', 'x', 'x']]), [card('yandos-K'), card('ozonik-9')]);
    assert.equal(pierce.log[0].sides[0].dealt, pierce.log[0].sides[0].attack);
  });

  await t('kombat rules: a card without the energy for it, or not in hand, counts as a missed turn', () => {
    const s0 = setup(calmSeed(), ['waldberik', 'ozonik'], [['avitos-A', 'x', 'x', 'x', 'x'], ['avitos-2', 'x', 'x', 'x', 'x']], 10);
    assert.equal(K.playProblem(s0.fighters[0], card('avitos-A')), 'energy');
    assert.equal(K.playProblem(s0.fighters[0], card('yandos-A')), 'not_in_hand');
    const s = K.resolveTurn(s0, [card('avitos-A'), null]);
    assert.deepEqual(s.log[0].sides.map((x) => x.play.kind), ['timeout', 'timeout']);
    assert.ok(s.fighters[0].hand.includes('avitos-A'));
  });

  await t('kombat rules: a knockout or the last turn ends the fight', () => {
    let s = K.createKombat(3, { character: 'yandos' }, { character: 'avitos' });
    while (!s.finished) s = K.resolveTurn(s, [K.botPlay(s, 0).play, rest]);
    assert.equal(s.winner, 0);
    let d = K.createKombat(4, { character: 'yandos' }, { character: 'avitos' });
    while (!d.finished) d = K.resolveTurn(d, [rest, rest]);
    assert.equal(d.log.length, K.KOMBAT_MAX_TURNS);
    assert.deepEqual([d.winner, d.reason], [null, 'turns']);
  });

  // ------------------------------------------------------------ fights
  const a = await player('ann', 'waldberik');
  const b = await player('bob', 'ozonik');
  const stunned = (v) => v.fighters[v.you].effects.some((e) => e.kind === 'stun');
  const me = (v) => v.fighters[v.you];
  /** The cheapest attack the player can pay for, or a rest that swaps a card that does not attack. */
  const attack = (v) => {
    const hits = v.hand.filter((c) => c !== 'joker' && K.cardDef(c).damage > 0 && K.cardDef(c).cost <= me(v).energy);
    if (hits.length) return card(hits.sort((x, y) => K.cardDef(x).cost - K.cardDef(y).cost)[0]);
    return { kind: 'rest', discard: v.hand.find((c) => c !== 'joker' && K.cardDef(c).damage === 0) ?? v.hand[0] };
  };
  /** A beats B: A attacks every turn, B only rests. */
  const fightOut = async (id) => {
    let v = await a.kombat.get(id);
    while (v.status === 'active') {
      const va = await a.kombat.get(id);
      if (va.status !== 'active') return va;
      if (!stunned(va)) await a.kombat.move(id, va.turn, attack(va));
      const vb = await b.kombat.get(id);
      v = vb.status === 'active' && vb.turn === va.turn && !stunned(vb) ? await b.kombat.move(id, vb.turn, rest) : vb;
    }
    return v;
  };

  await t('kombat: training with the computer has no stake and nothing to win', async () => {
    const before = await balance(a);
    let v = await a.kombat.start('bot', undefined, 'tr1');
    assert.deepEqual([v.mode, v.status, v.stake, v.fighters[1].isBot, v.hand.length, v.rules], ['bot', 'active', 0, true, 5, K.KOMBAT_RULES]);
    const realNow = server.now;
    let skew = 0;
    while (v.status === 'active') {
      if (stunned(v)) {
        // A stunned player waits a moment, then the computer's turn is played without them.
        skew += 3000;
        server.now = () => realNow() + skew;
        v = await a.kombat.get(v.id);
      } else v = await a.kombat.move(v.id, v.turn, attack(v));
    }
    server.now = realNow;
    assert.equal(v.status, 'finished');
    assert.equal(v.log.length, v.turn - 1);
    assert.deepEqual([v.settlement.payout, v.settlement.net, v.settlement.tx], [0, 0, null]);
    assert.equal(await balance(a), before);
    assert.equal((await a.me.get()).profile.stats.matches, 0);
  });

  await t('kombat: hands and plays are hidden from the opponent; the timer plays a missing card as a missed turn', async () => {
    const w = await a.kombat.start('pvp', 10, 'p1');
    assert.equal(w.status, 'waiting');
    assert.equal(await balance(a), 90);
    const j = await b.kombat.start('pvp', 10, 'p1');
    assert.deepEqual([j.status, j.you, j.fighters[0].nickname.length > 0, j.fighters[0].handSize], ['active', 1, true, 5]);
    assert.ok(!('hand' in j.fighters[0]) && !('deck' in j.fighters[0]), 'no hand of the opponent in the view');
    const va = await a.kombat.get(j.id);
    await expectErr(a.kombat.move(j.id, 1, card(K.DECK.find((c) => !va.hand.includes(c)))), 'invalid_input');
    if (va.hand.includes('joker')) await expectErr(a.kombat.move(j.id, 1, card('joker')), 'invalid_input');
    const dear = va.hand.find((c) => c !== 'joker' && K.cardDef(c).cost > me(va).energy);
    if (dear) await expectErr(a.kombat.move(j.id, 1, card(dear)), 'invalid_input');
    const chosen = attack(va);
    const mineA = await a.kombat.move(j.id, 1, chosen);
    assert.deepEqual(mineA.myPlay, chosen);
    const seenByB = await b.kombat.get(j.id);
    assert.deepEqual([seenByB.myPlay, seenByB.log.length], [null, 0]);
    const realNow = server.now;
    server.now = () => realNow() + K.KOMBAT_TURN_MS + 1000;
    const after = await b.kombat.get(j.id);
    assert.equal(after.log[0].sides[1].play.kind, 'timeout');
    assert.deepEqual(after.log[0].sides[0].play, chosen.kind === 'card' ? chosen : { kind: 'rest', discarded: true });
    assert.equal(after.turn, 2);
    assert.ok(after.log[0].at > after.startedAt);
    server.now = realNow;
    globalThis.fight = j.id;
  });

  await t('kombat: the winner takes both stakes minus 10% of the win; the loser loses the stake', async () => {
    const v = await fightOut(globalThis.fight);
    const sa = (await a.kombat.get(v.id)).settlement;
    const sb = (await b.kombat.get(v.id)).settlement;
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
    let skew = 2000;
    server.now = () => realNow() + skew;
    let v = await b.kombat.get(w.id);
    assert.equal(v.status, 'active');
    assert.equal(v.fighters[0].nickname.length > 0 && v.fighters[1].nickname, 'Sparring');
    while (v.status === 'active') {
      if (stunned(v)) {
        skew += 3000;
        v = await b.kombat.get(v.id);
      } else v = await b.kombat.move(v.id, v.turn, rest);
    }
    server.now = realNow;
    assert.equal(v.status, 'finished');
    assert.ok(v.log.length > 0);
    server.devSettings.sparring = false;
  });

  await t('history: finished fights, newest first, with every turn; nobody sees another player\'s', async () => {
    const page = await a.history.list('kombat');
    assert.ok(page.items.length >= 4);
    assert.ok(page.items.every((i) => i.game === 'kombat'));
    for (let i = 1; i < page.items.length; i++) assert.ok(page.items[i - 1].finishedAt >= page.items[i].finishedAt);
    const won = page.items.find((i) => i.id === globalThis.fight);
    assert.deepEqual([won.outcome, won.mode, won.net, won.opponent.character, won.turns > 0], ['win', 'pvp', 9, 'ozonik', true]);
    assert.ok(page.items.some((i) => i.outcome === 'cancelled'));
    const detail = await a.history.get(globalThis.fight);
    assert.equal(detail.kombat.log.length, won.turns);
    assert.equal(detail.kombat.status, 'finished');
    const first = await a.history.list('kombat', null, 2);
    assert.equal(first.items.length, 2);
    const second = await a.history.list('kombat', first.next, 2);
    assert.notEqual(second.items[0].id, first.items[0].id);
    const stranger = await player('sam', 'yandos');
    await expectErr(stranger.history.get(globalThis.fight), 'not_found');
    assert.equal((await stranger.history.list()).items.length, 0);
  });

  await t('kombat: fights of the old rules are reset once and their stakes come back', async () => {
    const kv2 = new MemoryKV();
    const server2 = new MockServer(kv2);
    const api = createApi(new MockTransport(server2, () => sim));
    const res = await api.auth.google(makeMockGoogleToken({ sub: 'g-old', email: 'old@gmail.com', name: 'old' }));
    api.setToken(res.session.token);
    await api.me.chooseCharacter('avitos', 'm');
    // A fight of the old rules with a stake of 5 ABIE (50 chips).
    server2.wallet.post(res.account.id, { id: 'old-stake', kind: 'currency_buy', amount: -5 });
    server2.currencyPost(res.account.id, 'kombat', { id: 'old-buy', kind: 'buy', amount: 50 });
    server2.currencyPost(res.account.id, 'kombat', { id: 'old-stake', kind: 'stake', amount: -50 });
    server2.db.table('fights').put('fight_old', {
      id: 'fight_old', mode: 'pvp', status: 'waiting', sides: [{ accountId: res.account.id, nickname: 'old', character: 'avitos', gender: 'm', requestId: 'x' }, null],
      stakeLots: 5, stake: 50, createdAt: Date.now(), seed: 1, state: null, deadline: null, moves: [null, null], settlements: [null, null],
    });
    assert.equal((await api.wallet.get()).balance, 95);
    const v = await api.kombat.start('bot', undefined, 'new1');
    assert.equal(v.rules, K.KOMBAT_RULES);
    assert.equal(server2.db.table('fights').get('fight_old'), undefined);
    assert.equal((await api.wallet.get()).balance, 100);
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
