process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.HUB_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const { ChannelType } = require('discord.js');
const { init, models } = require('../models');
const { search, acceptRequest, cancelSearch, purgeExpired, queueEvents } = require('../services/matchmaking');
const { announce, closePosts, openOriginThread, relayMessage, purgeClosedPosts, levelRange, postTitle } = require('../controller/praccBoard');
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
	const log = { threads: [], sent: [], edits: [], archived: [], threadMessages: [], webhook: [] };
	const messages = new Map();
	const channels = {};
	const message = (id, payload) => ({
		id,
		embeds: (payload.embeds || []).map(e => e.toJSON()),
		edit: async p => log.edits.push({ id, ...p }),
	});
	const makeThread = (id, parent) => {
		const thread = {
			id,
			parent,
			isThread: () => true,
			messages: { fetch: async mid => messages.get(mid) },
			send: async p => log.threadMessages.push({ thread: id, ...p }),
			setArchived: async v => log.archived.push({ thread: id, v }),
		};
		channels[id] = thread;
		return thread;
	};
	const withWebhooks = channel => Object.assign(channel, {
		fetchWebhooks: async () => new Map(),
		createWebhook: async ({ name }) => ({ name, owner: { id: 'bot' }, send: async p => log.webhook.push({ parent: channel.id, ...p }) }),
	});
	const forum = withWebhooks({
		id: 'forum1',
		type: ChannelType.GuildForum,
		availableTags: [{ id: 'tag-val', name: 'Valorant' }, { id: 'tag-scrim', name: 'Scrim' }, { id: 'tag-cs', name: 'Counter-Strike 2' }],
		threads: {
			create: async opts => {
				log.threads.push(opts);
				const starter = message('starter1', opts.message);
				messages.set(starter.id, starter);
				const thread = makeThread('thread1', forum);
				thread.fetchStarterMessage = async () => starter;
				return thread;
			},
		},
	});
	const text = withWebhooks({
		id: 'text1',
		type: ChannelType.GuildText,
		send: async payload => {
			log.sent.push(payload);
			const m = message('msg1', payload);
			m.startThread = async opts => {
				log.threads.push(opts);
				return makeThread('thread2', text);
			};
			messages.set(m.id, m);
			return m;
		},
		messages: { fetch: async id => messages.get(id) },
	});
	channels.forum1 = forum;
	channels.text1 = text;
	const client = {
		user: { id: 'bot' },
		channels: { fetch: async id => channels[id] },
		guilds: { cache: new Map([['g1', { name: 'Serveur Alpha' }]]) },
	};
	return { client, log };
}

function chatMessage(threadId, content, extra = {}) {
	return {
		guild: { name: 'Serveur Bravo' },
		author: { bot: false, username: 'kenji', displayAvatarURL: () => 'https://cdn.example/avatar.png' },
		member: { displayName: 'Kenji' },
		webhookId: null,
		channel: { isThread: () => true },
		channelId: threadId,
		content,
		attachments: new Map(),
		...extra,
	};
}

test('tableau : publication sur un forum (tags) et un salon textuel (fil), relais, puis clôture', async () => {
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
	assert.strictEqual(log.threads[1].name, '[VAL] Hotel <b> — Scrim BO1 · Diamant', 'salon textuel : un fil est ouvert sur le message');
	const embed = log.sent[0].embeds[0].toJSON();
	assert.match(embed.title, /Hotel <b> cherche un scrim Valorant/);
	assert.strictEqual(embed.fields.find(f => f.name === 'Serveur').value, 'Serveur Alpha');
	assert.strictEqual(log.sent[0].components[0].toJSON().components[0].custom_id, `pracc_accept_${entry.id}`);
	const posts = await models.PraccPosts.findAll({ where: { queueEntryId: entry.id } });
	assert.deepStrictEqual(posts.map(p => p.threadId).sort(), ['thread1', 'thread2']);

	// relais : écrit dans le fil du forum → recopié dans le fil du salon textuel, sans mentions
	assert.strictEqual(await relayMessage(client, chatMessage('thread1', 'On est dispo à 21h @everyone')), 1);
	assert.deepStrictEqual(log.webhook[0], {
		parent: 'text1', content: 'On est dispo à 21h @everyone', username: 'Kenji · Serveur Bravo',
		avatarURL: 'https://cdn.example/avatar.png', threadId: 'thread2', allowedMentions: { parse: [] },
	});
	assert.strictEqual(await relayMessage(client, chatMessage('thread1', 'bot', { author: { bot: true } })), 0, 'les bots ne sont pas relayés (pas de boucle)');
	assert.strictEqual(await relayMessage(client, chatMessage('autre-fil', 'hors demande')), 0);

	await closePosts(client, entry.id, 'expired', null);
	assert.strictEqual(log.edits.length, 2);
	assert.ok(log.edits.every(e => e.components.length === 0 && /Demande expirée/.test(e.embeds[0].toJSON().description)));
	assert.deepStrictEqual(log.archived.map(a => a.thread).sort(), ['thread1', 'thread2'], 'fils archivés');
	assert.strictEqual(await models.PraccPosts.count(), 0);
});

test('fil d\'origine pour une équipe sans salon pracc, relais conservé 24 h après un match', async () => {
	const { client, log } = fakeDiscord();
	const india = await makeTeam('India');
	const { entry } = await search({ ...params, team: india, level: 2, announce: false, guildId: 'g-sans-salon', channelId: 'origin-chan' });
	await announce(client, entry, india);
	const reply = { id: 'reply1', channelId: 'origin-chan', startThread: async () => ({ id: 'origin-thread', send: async () => undefined }) };
	const origin = await openOriginThread(reply, entry, india);
	assert.strictEqual(origin.kind, 'origin');

	// un serveur qui a déjà un salon pracc pour ce jeu n'a pas besoin de fil d'origine
	const g1Entry = { ...entry.get({ plain: true }), guildId: 'g1' };
	assert.strictEqual(await openOriginThread(reply, g1Entry, india), null);

	const juliet = await makeTeam('Juliet');
	const match = await acceptRequest({ entryId: entry.id, team: juliet, channelId: 'thread2', guildId: 'g2' });
	await closePosts(client, entry.id, 'matched', match);
	const kept = await models.PraccPosts.findAll({ where: { queueEntryId: entry.id } });
	assert.strictEqual(kept.length, 3);
	assert.ok(kept.every(p => p.closedAt), 'posts marqués clôturés mais conservés pour le relais');
	assert.ok(log.threadMessages.some(m => /Adversaire trouvé : India vs Juliet/.test(m.content)));
	assert.strictEqual(log.archived.length, 0, 'fils non archivés après un match');
	assert.strictEqual(await purgeClosedPosts(), 0);
	await models.PraccPosts.update({ closedAt: new Date(Date.now() - 25 * 3600 * 1000) }, { where: { queueEntryId: entry.id } });
	assert.strictEqual(await purgeClosedPosts(), 3);
});
