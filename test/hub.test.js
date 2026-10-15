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

		const notCaptain = await call('a2', '/veto', { value: view.veto.current.options[0] });
		assert.strictEqual(notCaptain.status, 400);

		while (view.status === 'veto') {
			const step = view.veto.current;
			const captain = step.team === 'A' ? 'a1' : 'b1';
			const res = await call(captain, '/veto', { value: step.options[0] });
			assert.strictEqual(res.status, 200, res.body.error);
			view = res.body;
		}
		assert.strictEqual(view.status, 'live');
		assert.strictEqual(view.veto.maps.length, 1);

		await call('a1', '/report', { winner: 'A' });
		view = (await call('b1', '/report', { winner: 'B' })).body;
		assert.strictEqual(view.status, 'disputed');
		view = (await call('b1', '/report', { winner: 'A' })).body;
		assert.strictEqual(view.status, 'finished');
		assert.strictEqual(view.result.winner, 'A');
	}
	finally {
		server.close();
	}
});
