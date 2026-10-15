process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.HUB_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const { init, models } = require('../models');
const { search } = require('../services/matchmaking');
const { createToken } = require('../services/hubToken');
const { createApp } = require('../web/server');

async function makeTeam(name, prefix) {
	const members = [1, 2, 3, 4, 5].map(i => ({ id: `${prefix}${i}`, name: `${name} ${i}` }));
	return models.MatchTeams.create({ name, game: 'valorant', size: 5, captainId: members[0].id, members: JSON.stringify(members) });
}

test('parcours complet : recherche, check-in, pick & ban, résultat', async () => {
	await init();
	const alpha = await makeTeam('Alpha', 'a');
	const bravo = await makeTeam('Bravo', 'b');
	const params = { format: 'bo1', type: 'scrim', tolerance: 1, channelId: 'c1', guildId: 'g1' };

	const first = await search({ ...params, team: alpha, level: 3, requestedBy: 'a1' });
	assert.strictEqual(first.status, 'queued');
	const second = await search({ ...params, team: bravo, level: 4, requestedBy: 'b1' });
	assert.strictEqual(second.status, 'matched');
	assert.strictEqual(await models.QueueEntries.count(), 0);

	const matchId = second.match.id;
	const server = createApp().listen(0);
	const base = `http://127.0.0.1:${server.address().port}/api/matches/${matchId}`;
	const call = async (user, path = '', body) => {
		const res = await fetch(base + path, {
			method: body ? 'POST' : 'GET',
			headers: { 'Content-Type': 'application/json', 'x-hub-token': createToken(matchId, user) },
			body: body ? JSON.stringify(body) : undefined,
		});
		return { status: res.status, body: await res.json() };
	};

	try {
		const unauthorized = await fetch(base, { headers: { 'x-hub-token': 'nope' } });
		assert.strictEqual(unauthorized.status, 401);

		const outsider = await call('intrus', '/checkin', {});
		assert.strictEqual(outsider.status, 400);

		let view;
		for (const prefix of ['a', 'b']) {
			for (let i = 1; i <= 5; i++) view = (await call(`${prefix}${i}`, '/checkin', {})).body;
		}
		assert.strictEqual(view.status, 'veto');

		const captainOf = team => view.teams[team].captainId;
		const nextAction = v => {
			const step = v.veto.current;
			if (step.t === 'side') return { side: v.veto.sides[0] };
			const used = new Set(v.veto.log.map(e => e.id));
			return { id: v.veto.pool.find(id => !used.has(id)) };
		};
		const winnerKey = view.teams.A.name === 'Alpha' ? 'A' : 'B';

		const notCaptain = await call(view.teams.A.members[1].id, '/veto', nextAction(view));
		assert.strictEqual(notCaptain.status, 400);
		const wrongTeam = await call(captainOf('B'), '/veto', nextAction(view));
		assert.strictEqual(wrongTeam.status, 400);

		// chrono écoulé sur un ban : pas encore expiré → rien ; expiré → ban sauté, le tour passe
		const { skipExpiredTurn } = require('../services/matchService');
		const before = await skipExpiredTurn(matchId);
		assert.strictEqual(before.veto.log.length, 0);
		const skipped = await skipExpiredTurn(matchId, Date.now() + 31_000);
		assert.deepStrictEqual(skipped.veto.log[0], { t: 'ban', team: 'A', id: null, skipped: true });
		view = (await call(captainOf('A'))).body;
		assert.strictEqual(view.veto.current.team, 'B');
		assert.strictEqual((await call(captainOf('A'), '/undo', {})).status, 400);
		view = (await call(captainOf('B'), '/veto', nextAction(view))).body;
		view = (await call(captainOf('B'), '/undo', {})).body;
		assert.strictEqual(view.veto.log.length, 1);

		// annulation : seul le capitaine qui vient d'agir peut annuler
		view = (await call(captainOf('B'), '/veto', nextAction(view))).body;
		assert.strictEqual(view.veto.log.length, 2);
		assert.strictEqual((await call(captainOf('A'), '/undo', {})).status, 400);
		view = (await call(captainOf('B'), '/undo', {})).body;
		assert.strictEqual(view.veto.log.length, 1);

		while (view.status === 'veto') {
			const res = await call(captainOf(view.veto.current.team), '/veto', nextAction(view));
			assert.strictEqual(res.status, 200, res.body.error);
			view = res.body;
		}
		assert.strictEqual(view.status, 'live');
		assert.strictEqual(view.veto.log.filter(e => e.t === 'decider').length, 1);
		assert.strictEqual(view.veto.log.filter(e => e.skipped).length, 1);
		assert.strictEqual(view.veto.log.length, 8);

		const loserKey = winnerKey === 'A' ? 'B' : 'A';
		await call('a1', '/report', { winner: winnerKey });
		view = (await call('b1', '/report', { winner: loserKey })).body;
		assert.strictEqual(view.status, 'disputed');
		view = (await call('b1', '/report', { winner: winnerKey })).body;
		assert.strictEqual(view.status, 'finished');
		assert.strictEqual(view.teams[view.result.winner].name, 'Alpha');
	}
	finally {
		server.close();
	}
});
