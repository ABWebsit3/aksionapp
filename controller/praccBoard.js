const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Events, PermissionsBitField, StringSelectMenuBuilder, userMention } = require('discord.js');
const { Op } = require('sequelize');
const { models } = require('../models');
const { GAMES, getGame, MATCH_TYPES } = require('../config/games');
const { queueEvents, acceptRequest, eligibleTeams } = require('../services/matchmaking');

/**
 * Tableau des demandes de pracc : chaque serveur peut choisir un salon (forum recommandé, ou textuel)
 * où apparaissent les demandes en attente de TOUS les serveurs. Chaque demande a un fil de discussion
 * par serveur (le post du forum, ou un fil ouvert sur le message), plus un fil sous la commande
 * /match chercher de l'équipe qui cherche. Les messages écrits dans l'un de ces fils sont relayés
 * dans tous les autres : les équipes discutent même si elles ne sont pas sur le même serveur.
 * Un capitaine peut accepter : le match et le hub sont créés aussitôt.
 */

const FORUM_TAGS = [...Object.values(GAMES).map(g => g.name), 'Scrim', 'Match officiel'];
const CLOSED_TEXT = {
	matched: match => `✅ Adversaire trouvé : ${match.teams.A.name} vs ${match.teams.B.name}`,
	expired: () => '⌛ Demande expirée',
	cancelled: () => '🛑 Demande annulée',
	replaced: () => '🔁 Remplacée par une nouvelle demande',
};
const REQUIRED_PERMS = [
	PermissionsBitField.Flags.ViewChannel,
	PermissionsBitField.Flags.SendMessages,
	PermissionsBitField.Flags.EmbedLinks,
	PermissionsBitField.Flags.SendMessagesInThreads,
];
const RELAY_WEBHOOK_NAME = 'PraccHub Relay';
// Après un match trouvé, le relais reste ouvert pour s'organiser (codes de lobby, horaires…)
const RELAY_AFTER_MATCH_MS = 24 * 60 * 60 * 1000;

/* ---------- mise en forme (pure) ---------- */

function levelRange(game, level, tolerance) {
	const min = Math.max(0, level - tolerance);
	const max = Math.min(game.levels.length - 1, level + tolerance);
	return min === max ? game.levels[min] : `${game.levels[min]} → ${game.levels[max]}`;
}

function postTitle(entry, team) {
	const game = getGame(entry.game);
	const kind = entry.type === 'scrim' ? 'Scrim' : 'Match';
	return `[${game.short}] ${team.name} — ${kind} ${entry.format.toUpperCase()} · ${levelRange(game, entry.level, entry.tolerance)}`.slice(0, 100);
}

function requestEmbed(entry, team, { origin } = {}) {
	const game = getGame(entry.game);
	const members = JSON.parse(team.members);
	return new EmbedBuilder()
		.setColor(0xe5484d)
		.setTitle(`🔎 ${team.name} cherche un ${entry.type === 'scrim' ? 'scrim' : 'match'} ${game.name}`)
		.addFields(
			{ name: 'Format', value: `${entry.format.toUpperCase()} · ${entry.size}v${entry.size}`, inline: true },
			{ name: 'Niveau', value: levelRange(game, entry.level, entry.tolerance), inline: true },
			{ name: 'Type', value: MATCH_TYPES[entry.type], inline: true },
			{ name: 'Capitaine', value: userMention(team.captainId), inline: true },
			{ name: 'Expire', value: `<t:${Math.floor(new Date(entry.expiresAt).getTime() / 1000)}:R>`, inline: true },
			{ name: 'Serveur', value: origin || '—', inline: true },
			{ name: `Joueurs (${members.length})`, value: members.map(m => m.name).join(', ').slice(0, 1000) || '—' },
		)
		.setFooter({ text: 'PraccHub • Discute dans le fil (relayé sur tous les serveurs), puis « Accepter le pracc » crée le match et le hub' });
}

function closedEmbed(original, reason, match) {
	const text = (CLOSED_TEXT[reason] || CLOSED_TEXT.cancelled)(match);
	return EmbedBuilder.from(original).setColor(0x5c6370).setDescription(`**${text}**`);
}

function acceptRow(entryId) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`pracc_accept_${entryId}`).setLabel('Accepter le pracc').setEmoji('🤝').setStyle(ButtonStyle.Success),
	);
}

/* ---------- publication ---------- */

function isForum(channel) {
	return channel.type === ChannelType.GuildForum;
}

function forumTagIds(channel, entry) {
	const wanted = [getGame(entry.game).name, entry.type === 'scrim' ? 'Scrim' : 'Match officiel'];
	return channel.availableTags.filter(t => wanted.includes(t.name)).map(t => t.id).slice(0, 5);
}

async function postTo(channel, entry, team, origin) {
	const payload = { embeds: [requestEmbed(entry, team, { origin })], components: [acceptRow(entry.id)] };
	if (isForum(channel)) {
		const thread = await channel.threads.create({ name: postTitle(entry, team), message: payload, appliedTags: forumTagIds(channel, entry) });
		const starter = await thread.fetchStarterMessage();
		return { channelId: channel.id, threadId: thread.id, messageId: starter.id };
	}
	const message = await channel.send(payload);
	const thread = await message.startThread({ name: postTitle(entry, team), autoArchiveDuration: 1440 }).catch(() => null);
	return { channelId: channel.id, threadId: thread ? thread.id : null, messageId: message.id };
}

/**
 * Fil de discussion sous la réponse à /match chercher, pour que l'équipe qui cherche voie les réponses
 * même si son serveur n'a pas de salon pracc (sinon elle les voit déjà dans son propre salon pracc).
 */
async function openOriginThread(message, entry, team) {
	const board = await models.GuildSettings.findByPk(entry.guildId);
	if (board && board.praccChannelId && (!board.praccGame || board.praccGame === entry.game)) return null;
	if (!(await models.QueueEntries.findByPk(entry.id))) return null;
	const thread = await message.startThread({ name: `💬 ${postTitle(entry, team)}`.slice(0, 100), autoArchiveDuration: 1440 });
	await thread.send({ content: 'Les réponses des autres serveurs à ta demande arrivent ici, et ce que tu écris est relayé chez eux.', allowedMentions: { parse: [] } });
	return models.PraccPosts.create({ queueEntryId: entry.id, guildId: entry.guildId, channelId: message.channelId, messageId: message.id, threadId: thread.id, kind: 'origin' });
}

async function announce(client, entry, team, onlyGuildId = null) {
	const where = onlyGuildId ? { guildId: onlyGuildId } : {};
	const boards = (await models.GuildSettings.findAll({ where })).filter(b => b.praccChannelId && (!b.praccGame || b.praccGame === entry.game));
	const origin = client.guilds.cache.get(entry.guildId)?.name;
	let posted = 0;
	for (const board of boards) {
		try {
			const channel = await client.channels.fetch(board.praccChannelId);
			const post = await postTo(channel, entry, team, origin);
			await models.PraccPosts.create({ queueEntryId: entry.id, guildId: board.guildId, ...post });
			posted++;
		}
		catch (error) {
			console.error(`Pracc : publication impossible sur ${board.guildId}/${board.praccChannelId} :`, error.message);
		}
	}
	return posted;
}

async function closePost(client, post, reason, match) {
	const text = (CLOSED_TEXT[reason] || CLOSED_TEXT.cancelled)(match);
	const thread = post.threadId ? await client.channels.fetch(post.threadId).catch(() => null) : null;
	if (post.kind === 'board') {
		const holder = await client.channels.fetch(post.channelId);
		// forum : le message d'annonce est dans le fil ; salon textuel : dans le salon
		const source = holder.type === ChannelType.GuildForum ? thread : holder;
		const message = await source.messages.fetch(post.messageId);
		await message.edit({ embeds: [closedEmbed(message.embeds[0], reason, match)], components: [] });
	}
	if (!thread) return;
	if (reason === 'matched') {
		await thread.send({ content: `**${text}**\nCe fil reste relayé 24 h pour vous organiser.`, allowedMentions: { parse: [] } }).catch(() => undefined);
	}
	else {
		await thread.send({ content: `**${text}**`, allowedMentions: { parse: [] } }).catch(() => undefined);
		await thread.setArchived(true).catch(() => undefined);
	}
}

async function closePosts(client, entryId, reason, match) {
	const posts = await models.PraccPosts.findAll({ where: { queueEntryId: entryId, closedAt: null } });
	for (const post of posts) {
		try {
			await closePost(client, post, reason, match);
		}
		catch (error) {
			console.error(`Pracc : mise à jour impossible du post ${post.messageId} :`, error.message);
		}
	}
	if (reason === 'matched') await models.PraccPosts.update({ closedAt: new Date() }, { where: { queueEntryId: entryId } });
	else await models.PraccPosts.destroy({ where: { queueEntryId: entryId } });
}

function purgeClosedPosts() {
	return models.PraccPosts.destroy({ where: { closedAt: { [Op.lt]: new Date(Date.now() - RELAY_AFTER_MATCH_MS) } } });
}

/* ---------- relais des discussions entre serveurs ---------- */

const webhookCache = new Map();

async function relayWebhook(client, parent) {
	if (webhookCache.has(parent.id)) return webhookCache.get(parent.id);
	let webhook = null;
	try {
		const hooks = await parent.fetchWebhooks();
		webhook = [...hooks.values()].find(h => h.name === RELAY_WEBHOOK_NAME && h.owner && h.owner.id === client.user.id)
			|| await parent.createWebhook({ name: RELAY_WEBHOOK_NAME });
	}
	catch {
		// Permission « Gérer les webhooks » absente : repli sur un message du bot
		webhook = null;
	}
	webhookCache.set(parent.id, webhook);
	return webhook;
}

function relayContent(message) {
	const files = [...message.attachments.values()].map(a => a.url);
	return [message.content, ...files].filter(Boolean).join('\n').slice(0, 1900);
}

/** Recopie un message écrit dans un fil de demande vers les fils des autres serveurs. */
async function relayMessage(client, message) {
	if (!message.guild || message.author.bot || message.webhookId || !message.channel.isThread()) return 0;
	const source = await models.PraccPosts.findOne({ where: { threadId: message.channelId } });
	if (!source) return 0;
	const content = relayContent(message);
	if (!content) return 0;
	const targets = await models.PraccPosts.findAll({ where: { queueEntryId: source.queueEntryId, threadId: { [Op.ne]: message.channelId } } });
	const author = (message.member && message.member.displayName) || message.author.globalName || message.author.username;
	const username = `${author} · ${message.guild.name}`.slice(0, 80);
	let relayed = 0;
	for (const target of targets) {
		if (!target.threadId) continue;
		try {
			const thread = await client.channels.fetch(target.threadId);
			const webhook = thread.parent ? await relayWebhook(client, thread.parent) : null;
			if (webhook) {
				await webhook.send({ content, username, avatarURL: message.author.displayAvatarURL(), threadId: thread.id, allowedMentions: { parse: [] } });
			}
			else {
				await thread.send({ content: `**${username}** : ${content}`.slice(0, 2000), allowedMentions: { parse: [] } });
			}
			relayed++;
		}
		catch (error) {
			console.error(`Pracc : relais impossible vers ${target.threadId} :`, error.message);
		}
	}
	return relayed;
}

function registerPraccBoard(client) {
	queueEvents.on('queued', ({ entry, team }) => announce(client, entry, team).catch(console.error));
	queueEvents.on('closed', ({ entryId, reason, match }) => closePosts(client, entryId, reason, match).catch(console.error));
	client.on(Events.MessageCreate, message => relayMessage(client, message).catch(console.error));
	setInterval(() => purgeClosedPosts().catch(console.error), 60 * 60 * 1000).unref();
}

/* ---------- configuration (/pracc) ---------- */

async function ensureForumTags(channel) {
	const missing = FORUM_TAGS.filter(name => !channel.availableTags.some(t => t.name === name));
	if (!missing.length) return true;
	const tags = [...channel.availableTags, ...missing.map(name => ({ name }))].slice(0, 20);
	return channel.setAvailableTags(tags).then(() => true, () => false);
}

function missingPermissions(channel, me) {
	const perms = channel.permissionsFor(me);
	const required = isForum(channel) ? REQUIRED_PERMS : [...REQUIRED_PERMS, PermissionsBitField.Flags.CreatePublicThreads];
	return required.filter(flag => !perms || !perms.has(flag)).map(flag => new PermissionsBitField(flag).toArray()[0]);
}

/** Enregistre le salon et y publie les demandes déjà ouvertes. */
async function configureBoard(interaction, channel, gameId) {
	const missing = missingPermissions(channel, interaction.guild.members.me);
	if (missing.length) throw new Error(`Il me manque des permissions dans ${channel} : ${missing.join(', ')}.`);

	await models.GuildSettings.upsert({ guildId: interaction.guildId, praccChannelId: channel.id, praccGame: gameId || null });

	const scope = gameId ? getGame(gameId).name : 'tous les jeux';
	const intro = `**PraccHub — demandes de pracc (${scope})**\nLes demandes des équipes de tous les serveurs PraccHub apparaissent ici.\n• Pour publier : \`/match chercher\` (ta demande est diffusée tant qu'aucun adversaire n'est trouvé).\n• Pour répondre : écris dans le fil de la demande (c'est relayé aux autres serveurs), puis clique sur **Accepter le pracc** avec ton équipe (\`/equipe creer\`).`;
	let tagsOk = true;
	if (isForum(channel)) {
		tagsOk = await ensureForumTags(channel);
		await channel.threads.create({ name: '📌 Comment ça marche', message: { content: intro } }).catch(() => undefined);
	}
	else {
		await channel.send({ content: intro });
	}

	const where = gameId ? { game: gameId } : {};
	const open = await models.QueueEntries.findAll({ where });
	let backfilled = 0;
	for (const entry of open) {
		const team = await models.MatchTeams.findByPk(entry.teamId);
		if (team) backfilled += await announce(interaction.client, entry, team, interaction.guildId);
	}
	return { tagsOk, backfilled };
}

/* ---------- réponses aux demandes ---------- */

async function onAcceptButton(interaction) {
	const entryId = parseInt(interaction.customId.replace('pracc_accept_', ''));
	const entry = await models.QueueEntries.findByPk(entryId);
	if (!entry) return interaction.reply({ content: 'Cette demande n\'est plus disponible.', ephemeral: true });
	const teams = await eligibleTeams(interaction.user.id, entry);
	const game = getGame(entry.game);
	if (!teams.length) {
		return interaction.reply({
			content: `Pour accepter, il faut être capitaine d'une équipe ${game.name} ${entry.size}v${entry.size}. Crée-la avec \`/equipe creer\` puis ajoute tes joueurs avec \`/equipe ajouter\`.`,
			ephemeral: true,
		});
	}
	const select = new StringSelectMenuBuilder()
		.setCustomId(`pracc_pick_${entry.id}`)
		.setPlaceholder('Avec quelle équipe ?')
		.addOptions(teams.slice(0, 25).map(t => ({ label: t.name.slice(0, 100), value: t.id.toString(), description: `${JSON.parse(t.members).length} joueur(s)` })));
	return interaction.reply({
		content: `Accepter ce ${entry.type === 'scrim' ? 'scrim' : 'match'} ${game.name} (${entry.format.toUpperCase()}) ? Choisis ton équipe : le match et le hub seront créés immédiatement.`,
		components: [new ActionRowBuilder().addComponents(select)],
		ephemeral: true,
	});
}

async function onTeamPicked(interaction) {
	const entryId = parseInt(interaction.customId.replace('pracc_pick_', ''));
	const team = await models.MatchTeams.findByPk(parseInt(interaction.values[0]));
	if (!team || team.captainId !== interaction.user.id) {
		return interaction.update({ content: 'Seul le capitaine de l\'équipe peut accepter.', components: [] });
	}
	try {
		await acceptRequest({ entryId, team, channelId: interaction.channelId, guildId: interaction.guildId });
		return interaction.update({ content: `🎯 C'est parti ! **${team.name}** a accepté. Les infos du match (check-in, hub) arrivent dans ce salon.`, components: [] });
	}
	catch (error) {
		return interaction.update({ content: `❌ ${error.message}`, components: [] });
	}
}

module.exports = {
	registerPraccBoard,
	configureBoard,
	onAcceptButton,
	onTeamPicked,
	announce,
	closePosts,
	openOriginThread,
	relayMessage,
	purgeClosedPosts,
	levelRange,
	postTitle,
	requestEmbed,
};
