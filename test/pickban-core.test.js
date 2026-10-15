// Tests portés depuis docs/pickban-handoff/tests/pickban-core.test.js (pools injectés au lieu d'être codés en dur)
const test = require('node:test');
const assert = require('node:assert');
const PB = require('../services/pickban-core');
const { GAMES } = require('../config/games');

const MAPS = { valorant: GAMES.valorant.maps.map(m => m.id), cs2: GAMES.cs2.maps.map(m => m.id) };
const sidesOf = game => GAMES[game].sides.map(([name]) => name);
const HEROES = Array.from({ length: 40 }, (_, i) => `hero${i}`);

function mapsState(game, format) {
	return PB.createState({ kind: 'maps', seq: format, pool: MAPS[game], sides: sidesOf(game) });
}

function playAll(state) {
	let s = state;
	let guard = 0;
	while (!PB.isDone(s) && guard++ < 100) {
		const step = PB.currentStep(s);
		if (step.t === 'side') {
			s = PB.apply(s, { team: step.team, side: s.sides[0] });
		}
		else {
			const used = PB.statusMap(s);
			s = PB.apply(s, { team: step.team, id: s.pool.find(id => !used[id]) });
		}
	}
	return s;
}

const count = (s, t, team) => s.log.filter(e => e.t === t && (team === undefined || e.team === team)).length;

test('Valorant BO3 : 4 bans, 2 picks, 1 décisive, 3 choix de côté', () => {
	const s = playAll(mapsState('valorant', 'bo3'));
	assert.strictEqual(count(s, 'ban'), 4);
	assert.strictEqual(count(s, 'pick'), 2);
	assert.strictEqual(count(s, 'decider'), 1);
	assert.strictEqual(count(s, 'side'), 3);
	assert.strictEqual(s.log.length, 10);
});

test('CS2 BO1 : 6 bans + décisive + côté (équipe B), toutes les cartes utilisées une fois', () => {
	const s = playAll(mapsState('cs2', 'bo1'));
	assert.strictEqual(count(s, 'ban'), 6);
	assert.strictEqual(count(s, 'decider'), 1);
	assert.strictEqual(s.log[s.log.length - 1].team, 'B');
	const ids = s.log.filter(e => e.id && e.t !== 'side').map(e => e.id);
	assert.strictEqual(new Set(ids).size, 7);
});

test('LoL : 5 bans et 5 picks par équipe', () => {
	const s = playAll(PB.createState({ kind: 'draft', seq: 'lol', pool: HEROES }));
	for (const team of ['A', 'B']) {
		assert.strictEqual(count(s, 'ban', team), 5);
		assert.strictEqual(count(s, 'pick', team), 5);
	}
});

test('Dota 2 : 7 bans et 5 picks par équipe', () => {
	const s = playAll(PB.createState({ kind: 'draft', seq: 'dota', pool: HEROES }));
	for (const team of ['A', 'B']) {
		assert.strictEqual(count(s, 'ban', team), 7);
		assert.strictEqual(count(s, 'pick', team), 5);
	}
});

test('refuse une action hors tour, un élément déjà pris ou hors pool, un côté invalide', () => {
	let s = mapsState('valorant', 'bo3');
	assert.throws(() => PB.apply(s, { team: 'B', id: 'haven' }), /tour/);
	assert.throws(() => PB.apply(s, { team: 'A', id: 'ascent' }), /inconnu/);
	s = PB.apply(s, { team: 'A', id: 'haven' });
	assert.throws(() => PB.apply(s, { team: 'B', id: 'haven' }), /déjà/);
	s = PB.apply(PB.apply(s, { team: 'B', id: 'bind' }), { team: 'A', id: 'lotus' });
	assert.throws(() => PB.apply(s, { team: 'B', side: 'Milieu' }), /Côté invalide/);
});

test('undo retire aussi la carte décisive automatique', () => {
	let s = mapsState('cs2', 'bo1');
	['ancient', 'anubis', 'cache', 'dust2', 'inferno', 'mirage'].forEach((id, i) => {
		s = PB.apply(s, { team: i % 2 ? 'B' : 'A', id });
	});
	assert.strictEqual(s.log[s.log.length - 1].t, 'decider');
	assert.strictEqual(PB.lastActor(s), 'B');
	s = PB.undo(s);
	assert.strictEqual(s.log.length, 5);
});

test('le choix de côté porte sur la dernière carte choisie', () => {
	let s = mapsState('valorant', 'bo3');
	s = PB.apply(s, { team: 'A', id: 'abyss' });
	s = PB.apply(s, { team: 'B', id: 'lotus' });
	s = PB.apply(s, { team: 'A', id: 'haven' });
	s = PB.apply(s, { team: 'B', side: 'Défense' });
	assert.deepStrictEqual(s.log[3], { t: 'side', team: 'B', side: 'Défense', mapId: 'haven' });
});

test('Rocket League : un seul choix de côté par le gagnant du pile ou face', () => {
	const s = PB.createState({ kind: 'sides', seq: 'sides', pool: [], sides: sidesOf('rocketleague') });
	const done = PB.apply(s, { team: 'A', side: 'Équipe orange' });
	assert.ok(PB.isDone(done));
	assert.deepStrictEqual(done.log, [{ t: 'side', team: 'A', side: 'Équipe orange', mapId: null }]);
});

test('noms de phase', () => {
	const seq = PB.SEQS.lol;
	assert.strictEqual(PB.phaseName(seq, 0), 'Bans 1');
	assert.strictEqual(PB.phaseName(seq, 6), 'Picks 1');
	assert.strictEqual(PB.phaseName(seq, 12), 'Bans 2');
	assert.strictEqual(PB.phaseName(PB.SEQS.bo1, 6), 'Carte décisive');
});

test('chrono écoulé : le ban est sauté et le tour passe à l\'équipe suivante', () => {
	let s = PB.createState({ kind: 'draft', seq: 'lol', pool: HEROES });
	s = PB.skip(s, 'A');
	assert.deepStrictEqual(s.log[0], { t: 'ban', team: 'A', id: null, skipped: true });
	assert.strictEqual(PB.currentStep(s).team, 'B');
	assert.strictEqual(PB.lastActor(s), null, 'un ban sauté ne peut pas être annulé');
	assert.deepStrictEqual(PB.statusMap(s), {});
	assert.throws(() => PB.skip(s, 'A'), /tour/);
});

test('seuls les bans peuvent être sautés', () => {
	let s = PB.createState({ kind: 'draft', seq: 'lol', pool: HEROES });
	for (let i = 0; i < 6; i++) s = PB.skip(s, PB.currentStep(s).team);
	assert.strictEqual(PB.currentStep(s).t, 'pick');
	assert.throws(() => PB.skip(s, 'A'), /Seul un ban/);
});

test('BO1 avec un ban sauté : la décisive est tirée parmi les cartes restantes (seed)', () => {
	const pool = MAPS.cs2;
	const run = seed => {
		let s = PB.createState({ kind: 'maps', seq: 'bo1', pool, sides: sidesOf('cs2'), seed });
		['ancient', 'anubis', 'cache', 'dust2', 'inferno'].forEach((id, i) => {
			s = PB.apply(s, { team: i % 2 ? 'B' : 'A', id });
		});
		s = PB.skip(s, 'B');
		return s.log[s.log.length - 1];
	};
	assert.deepStrictEqual(run(0), { t: 'decider', team: null, id: 'mirage' });
	assert.deepStrictEqual(run(1), { t: 'decider', team: null, id: 'nuke' });
});
