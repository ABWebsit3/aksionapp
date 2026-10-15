const test = require('node:test');
const assert = require('node:assert');
const { findOpponent } = require('../services/matchmaking');

const base = { game: 'valorant', size: 5, format: 'bo1', type: 'scrim', level: 4, tolerance: 1 };
const entry = { ...base, teamId: 1, memberIds: ['u1', 'u2'] };

test('trouve l\'adversaire compatible le plus ancien', () => {
	const candidates = [
		{ ...base, id: 10, teamId: 2, memberIds: ['x'], createdAt: '2026-10-15T10:05:00Z' },
		{ ...base, id: 11, teamId: 3, memberIds: ['y'], level: 5, createdAt: '2026-10-15T10:00:00Z' },
	];
	assert.strictEqual(findOpponent(entry, candidates).id, 11);
});

test('respecte la tolérance la plus stricte des deux équipes', () => {
	const strict = { ...base, id: 12, teamId: 4, memberIds: ['z'], level: 5, tolerance: 0, createdAt: '2026-10-15T10:00:00Z' };
	assert.strictEqual(findOpponent(entry, [strict]), null);
	const far = { ...base, id: 13, teamId: 5, memberIds: ['w'], level: 7, tolerance: 3, createdAt: '2026-10-15T10:00:00Z' };
	assert.strictEqual(findOpponent(entry, [far]), null);
});

test('ignore jeu/format/type différents, sa propre équipe et les joueurs en commun', () => {
	const t = '2026-10-15T10:00:00Z';
	const candidates = [
		{ ...base, id: 1, teamId: 1, memberIds: ['a'], createdAt: t },
		{ ...base, id: 2, teamId: 6, memberIds: ['b'], game: 'cs2', createdAt: t },
		{ ...base, id: 3, teamId: 7, memberIds: ['c'], format: 'bo3', createdAt: t },
		{ ...base, id: 4, teamId: 8, memberIds: ['d'], type: 'match', createdAt: t },
		{ ...base, id: 5, teamId: 9, memberIds: ['u2'], createdAt: t },
	];
	assert.strictEqual(findOpponent(entry, candidates), null);
});
