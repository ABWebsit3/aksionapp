process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.HUB_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const { ChannelType } = require('discord.js');
const { init, models } = require('../models');
const { search, acceptRequest, cancelSearch, purgeExpired, queueEvents } = require('../services/matchmaking');
const { announce, closePosts, levelRange, postTitle } = require('../controller/praccBoard');
const { getGame } = require('../config/games');

let teamCount = 0;
async function makeTeam(name, { game = 'valorant', size = 5, members } = {}) {
	teamCount++;
	const list = members || Array.from({ length: size }, (_, i) => ({ id: `t${teamCount}_${i}`, name: `${name} ${i}` }));
	return models.MatchTeams.create({ name, game, size, captainId: list[0].id, members: JSON.stringify(list) });
}
const params = { format: 'bo1', type: 'scrim', tolerance: 0, channelId: 'chan-origin', guildId: 'g1' };

const closed = [];
queueEvents.on('closed', e => closed.push(e));

test.before(() => init());

test('mise en forme : plage de niveaux et titre de post', () => {
	const game = getGame('valorant');
	assert.strictEqual(levelRange(game, 3, 1), 'Argent → Platine');
	assert.strictEqual(levelRange(game, 0, 0), 'Fer');
	assert.strictEqual(levelRange(game, 8, 2), 'Ascendant → Radiant');
	const title = postTitle({ game: 'valorant', type: 'scrim', format: 'bo3', level: 4, tolerance: 1 }, { name: 'X'.repeat(120) });
	assert.ok(title.startsWith('[VAL] '));
	assert.ok(title.length <= 100);
});

test('accepter une demande crée le match aux conditions de la demande, sans contrôle de niveau', async () => {
	const alpha = await makeTeam('Alpha');
	const bravo = await makeTeam('Bravo');
	const queued = await search({ ...params, team: alpha, level: 1, requestedBy: alpha.captainId });
	assert.strictEqual(queued.status, 'queued');

	const match = await acceptRequest({ entryId: queued.entry.id, team: bravo, channelId: 'chan-board-thread', guildId: 'g2' });
	assert.strictEqual(match.format, 'bo1');
	assert.strictEqual(match.level, 1);
	assert.deepStrictEqual([match.teams.A.name, match.teams.B.name], ['Alpha', 'Bravo']);
	assert.strictEqual(match.teams.B.channelId, 'chan-board-thread');
	assert.strictEqual(await models.QueueEntries.count(), 0);
	assert.deepStrictEqual(closed.pop(), { entryId: queued.entry.id, reason: 'matched', match });

	await assert.rejects(() => acceptRequest({ entryId: queued.entry.id, team: bravo, channelId: 'c', guildId: 'g' }), /plus disponible/);
});

test('refus : sa propre demande, mauvais jeu ou taille, joueur commun, équipe incomplète', async () => {
	const charlie = await makeTeam('Charlie');
	const { entry } = await search({ ...params, team: charlie, level: 4 });
	const accept = team => acceptRequest({ entryId: entry.id, team, channelId: 'c', guildId: 'g' });
	await assert.rejects(() => accept(charlie), /ton équipe/);
	await assert.rejects(async () => accept(await makeTeam('Delta', { game: 'cs2' })), /ne correspond pas/);
	const shared = JSON.parse(charlie.members).slice(0, 1).concat([1, 2, 3, 4].map(i => ({ id: `x${i}`, name: `x${i}` })));
	await assert.rejects(async () => accept(await makeTeam('Echo', { members: shared })), /aussi dans l'équipe adverse/);
	const incomplete = await makeTeam('Foxtrot', { members: [{ id: 'solo', name: 'solo' }] });
	await assert.rejects(() => accept(incomplete), /il en faut 5/);
	assert.strictEqual(await models.QueueEntries.count(), 1);

	await cancelSearch(charlie.id);
	assert.strictEqual(closed.pop().reason, 'cancelled');
});

test('événements de clôture : demande remplacée et demande expirée', async () => {
	const golf = await makeTeam('Golf');
	const first = await search({ ...params, team: golf, level: 2 });
	const second = await search({ ...params, team: golf, level: 2 });
	assert.deepStrictEqual(closed.pop(), { entryId: first.entry.id, reason: 'replaced', match: null });
	await second.entry.update({ expiresAt: new Date(Date.now() - 1000) });
	await purgeExpired();
	assert.deepStrictEqual(closed.pop(), { entryId: second.entry.id, reason: 'expired', match: null });
});

function fakeDiscord() {
	const log = { threads: [], sent: [], edits: [], archived: [] };
	const message = (id, payload) => ({
		id,
		embeds: payload.embeds.map(e => e.toJSON()),
		edit: async p => log.edits.push({ id, ...p }),
	});
	const messages = new Map();
	const forum = {
		id: 'forum1',
		type: ChannelType.GuildForum,
		availableTags: [{ id: 'tag-val', name: 'Valorant' }, { id: 'tag-scrim', name: 'Scrim' }, { id: 'tag-cs', name: 'Counter-Strike 2' }],
		threads: {
			create: async opts => {
				log.threads.push(opts);
				const starter = message('starter1', opts.message);
				messages.set(starter.id, starter);
				const thread = {
					id: 'thread1',
					fetchStarterMessage: async () => starter,
					messages: { fetch: async id => messages.get(id) },
					setArchived: async v => log.archived.push(v),
				};
				channels.thread1 = thread;
				return thread;
			},
		},
	};
	const text = {
		id: 'text1',
		type: ChannelType.GuildText,
		send: async payload => {
			log.sent.push(payload);
			const m = message('msg1', payload);
			messages.set(m.id, m);
			return m;
		},
		messages: { fetch: async id => messages.get(id) },
	};
	const channels = { forum1: forum, text1: text };
	const client = { channels: { fetch: async id => channels[id] }, guilds: { cache: new Map([['g1', { name: 'Serveur Alpha' }]]) } };
	return { client, log };
}

test('tableau : publication sur un forum (tags) et un salon textuel, puis clôture', async () => {
	await models.GuildSettings.bulkCreate([
		{ guildId: 'g1', praccChannelId: 'forum1' },
		{ guildId: 'g2', praccChannelId: 'text1', praccGame: 'valorant' },
		{ guildId: 'g3', praccChannelId: 'ailleurs', praccGame: 'cs2' },
	]);
	const { client, log } = fakeDiscord();
	const hotel = await makeTeam('Hotel <b>');
	const { entry } = await search({ ...params, team: hotel, level: 5, announce: false });

	const posted = await announce(client, entry, hotel);
	assert.strictEqual(posted, 2, 'le serveur filtré sur CS2 ne reçoit pas la demande Valorant');
	assert.strictEqual(log.threads[0].name, '[VAL] Hotel <b> — Scrim BO1 · Diamant');
	assert.deepStrictEqual(log.threads[0].appliedTags, ['tag-val', 'tag-scrim']);
	const embed = log.sent[0].embeds[0].toJSON();
	assert.match(embed.title, /Hotel <b> cherche un scrim Valorant/);
	assert.strictEqual(embed.fields.find(f => f.name === 'Serveur').value, 'Serveur Alpha');
	assert.strictEqual(log.sent[0].components[0].toJSON().components[0].custom_id, `pracc_accept_${entry.id}`);
	assert.strictEqual(await models.PraccPosts.count({ where: { queueEntryId: entry.id } }), 2);

	await closePosts(client, entry.id, 'expired', null);
	assert.strictEqual(log.edits.length, 2);
	assert.ok(log.edits.every(e => e.components.length === 0 && /Demande expirée/.test(e.embeds[0].toJSON().description)));
	assert.deepStrictEqual(log.archived, [true], 'le fil du forum est archivé');
	assert.strictEqual(await models.PraccPosts.count(), 0);
});
