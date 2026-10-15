// Lancer : node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const PB = require('../prototype/pickban-core.js');

function playAll(game, format) {
  let m = PB.createMatch(game, format);
  const g = PB.GAMES[game];
  let guard = 0;
  while (!PB.isDone(m) && guard++ < 100) {
    const step = PB.currentStep(m);
    if (step.t === 'side') m = PB.apply(m, { team: step.team, side: g.sides[0][0] });
    else {
      const used = PB.statusMap(m);
      const free = g.pool.find((p) => !used[p.id]);
      m = PB.apply(m, { team: step.team, id: free.id });
    }
  }
  return m;
}

const count = (m, t, team) => m.log.filter((e) => e.t === t && (team === undefined || e.team === team)).length;

test('Valorant BO3 : 4 bans, 2 picks, 1 décisive, 3 choix de côté', () => {
  const m = playAll('valorant', 'bo3');
  assert.strictEqual(count(m, 'ban'), 4);
  assert.strictEqual(count(m, 'pick'), 2);
  assert.strictEqual(count(m, 'decider'), 1);
  assert.strictEqual(count(m, 'side'), 3);
  assert.strictEqual(m.log.length, 10);
});

test('CS2 BO1 : 6 bans + décisive + côté, toutes les cartes utilisées une fois', () => {
  const m = playAll('cs2', 'bo1');
  assert.strictEqual(count(m, 'ban'), 6);
  assert.strictEqual(count(m, 'decider'), 1);
  const ids = m.log.filter((e) => e.id && e.t !== 'side').map((e) => e.id);
  assert.strictEqual(new Set(ids).size, 7);
});

test('LoL : 5 bans et 5 picks par équipe', () => {
  const m = playAll('lol');
  for (const team of ['A', 'B']) {
    assert.strictEqual(count(m, 'ban', team), 5);
    assert.strictEqual(count(m, 'pick', team), 5);
  }
});

test('Dota 2 : 7 bans et 5 picks par équipe', () => {
  const m = playAll('dota');
  for (const team of ['A', 'B']) {
    assert.strictEqual(count(m, 'ban', team), 7);
    assert.strictEqual(count(m, 'pick', team), 5);
  }
});

test('refuse une action hors tour ou un élément déjà pris', () => {
  let m = PB.createMatch('valorant', 'bo3');
  assert.throws(() => PB.apply(m, { team: 'B', id: 'haven' }), /tour/);
  m = PB.apply(m, { team: 'A', id: 'haven' });
  assert.throws(() => PB.apply(m, { team: 'B', id: 'haven' }), /déjà/);
});

test('undo retire aussi la carte décisive automatique', () => {
  let m = PB.createMatch('cs2', 'bo1');
  const ids = ['ancient', 'anubis', 'cache', 'dust2', 'inferno', 'mirage'];
  ids.forEach((id, i) => { m = PB.apply(m, { team: i % 2 ? 'B' : 'A', id }); });
  assert.strictEqual(m.log[m.log.length - 1].t, 'decider');
  m = PB.undo(m);
  assert.strictEqual(m.log.length, 5);
});

test('le choix de côté porte sur la dernière carte choisie', () => {
  let m = PB.createMatch('valorant', 'bo3');
  m = PB.apply(m, { team: 'A', id: 'abyss' });
  m = PB.apply(m, { team: 'B', id: 'lotus' });
  m = PB.apply(m, { team: 'A', id: 'haven' });
  m = PB.apply(m, { team: 'B', side: 'Défense' });
  assert.deepStrictEqual(m.log[3], { t: 'side', team: 'B', side: 'Défense', mapId: 'haven' });
});
