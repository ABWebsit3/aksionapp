const test = require('node:test');
const assert = require('node:assert');
const { GAMES } = require('../config/games');
const { createVeto, currentStep, applyAction } = require('../services/veto');

function playOut(veto, pick = options => options[0]) {
	let state = veto;
	while (!state.done) {
		const step = currentStep(state);
		state = applyAction(state, step.team, pick(step.options));
	}
	return state;
}

test('BO1 Valorant : 6 bans alternés, une map décisive, un choix de côté', () => {
	const veto = createVeto(GAMES.valorant, 'bo1', 'A');
	const teams = [];
	let state = veto;
	while (!state.done) {
		const step = currentStep(state);
		teams.push(`${step.team}:${step.action}`);
		state = applyAction(state, step.team, step.options[0]);
	}
	assert.deepStrictEqual(teams, ['A:ban', 'B:ban', 'A:ban', 'B:ban', 'A:ban', 'B:ban', 'A:side']);
	assert.strictEqual(state.maps.length, 1);
	assert.strictEqual(state.maps[0].pickedBy, null);
	assert.deepStrictEqual(state.maps[0].side, { team: 'A', value: 'Attaque' });
});

test('BO3 CS2 : ban ban pick side pick side ban ban décisive side', () => {
	let state = createVeto(GAMES.cs2, 'bo3', 'B');
	const seq = [];
	while (!state.done) {
		const step = currentStep(state);
		seq.push(`${step.team}:${step.action}`);
		state = applyAction(state, step.team, step.options[0]);
	}
	assert.deepStrictEqual(seq, ['B:ban', 'A:ban', 'B:pick', 'A:side', 'A:pick', 'B:side', 'B:ban', 'A:ban', 'B:side']);
	assert.strictEqual(state.maps.length, 3);
	assert.deepStrictEqual(state.maps.map(m => m.pickedBy), ['B', 'A', null]);
	assert.ok(state.maps.every(m => m.side));
	const all = new Set(state.maps.map(m => m.map));
	assert.strictEqual(all.size, 3);
});

test('refuse une action hors tour ou une map déjà bannie', () => {
	const state = createVeto(GAMES.valorant, 'bo1', 'A');
	assert.throws(() => applyAction(state, 'B', 'Bind'), /pas au tour/);
	const next = applyAction(state, 'A', 'Bind');
	assert.throws(() => applyAction(next, 'B', 'Bind'), /invalide/);
	assert.ok(state.remaining.includes('Bind'), 'l\'état original ne doit pas être modifié');
});

test('LoL : simple choix de côté ; Dota 2 : côté puis ordre de pick', () => {
	const lol = playOut(createVeto(GAMES.lol, 'bo1', 'A'));
	assert.deepStrictEqual(lol.choices.side, { team: 'A', value: 'Côté bleu' });
	const dota = playOut(createVeto(GAMES.dota2, 'bo3', 'B'), o => o[1]);
	assert.deepStrictEqual(dota.choices.side, { team: 'B', value: 'Dire' });
	assert.deepStrictEqual(dota.choices.extra, { team: 'A', value: 'Second pick' });
});
