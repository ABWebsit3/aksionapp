const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionsBitField, StringSelectMenuBuilder, userMention } = require('discord.js');
const { models } = require('../models');
const { GAMES, getGame, MATCH_TYPES } = require('../config/games');
const { queueEvents, acceptRequest, eligibleTeams } = require('../services/matchmaking');

/**
 * Tableau des demandes de pracc : chaque serveur peut choisir un salon (forum recommandé, ou textuel)
 * où apparaissent les demandes en attente de TOUS les serveurs. Les joueurs discutent dans le post
 * et un capitaine peut accepter : le match et le hub sont créés aussitôt.
 */

const FORUM_TAGS = [...Object.values(GAMES).map(g => g.name), 'Scrim', 'Match officiel'];
const CLOSED_TEXT = {
	matched: match => `✅ Adversaire trouvé : ${match.teams.A.name} vs ${match.teams.B.name}`,
	expired: () => '⌛ Demande expirée',
	cancelled: () => '🛑 Demande annulée',
	replaced: () => '🔁 Remplacée par une nouvelle demande',
};
const REQUIRED_PERMS = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks];

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
		.setFooter({ text: 'PraccHub • Discute ici, puis « Accepter le pracc » crée le match et le hub' });
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
	return { channelId: channel.id, threadId: null, messageId: message.id };
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

async function closePosts(client, entryId, reason, match) {
	const posts = await models.PraccPosts.findAll({ where: { queueEntryId: entryId } });
	for (const post of posts) {
		try {
			const channel = await client.channels.fetch(post.threadId || post.channelId);
			const message = await channel.messages.fetch(post.messageId);
			await message.edit({ embeds: [closedEmbed(message.embeds[0], reason, match)], components: [] });
			// Le fil reste ouvert quand un match est trouvé (les équipes peuvent y discuter)
			if (post.threadId && reason !== 'matched') await channel.setArchived(true).catch(() => undefined);
		}
		catch (error) {
			console.error(`Pracc : mise à jour impossible du post ${post.messageId} :`, error.message);
		}
	}
	await models.PraccPosts.destroy({ where: { queueEntryId: entryId } });
}

function registerPraccBoard(client) {
	queueEvents.on('queued', ({ entry, team }) => announce(client, entry, team).catch(console.error));
	queueEvents.on('closed', ({ entryId, reason, match }) => closePosts(client, entryId, reason, match).catch(console.error));
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
	const required = isForum(channel) ? [...REQUIRED_PERMS, PermissionsBitField.Flags.SendMessagesInThreads] : REQUIRED_PERMS;
	return required.filter(flag => !perms || !perms.has(flag)).map(flag => new PermissionsBitField(flag).toArray()[0]);
}

/** Enregistre le salon et y publie les demandes déjà ouvertes. */
async function configureBoard(interaction, channel, gameId) {
	const missing = missingPermissions(channel, interaction.guild.members.me);
	if (missing.length) throw new Error(`Il me manque des permissions dans ${channel} : ${missing.join(', ')}.`);

	await models.GuildSettings.upsert({ guildId: interaction.guildId, praccChannelId: channel.id, praccGame: gameId || null });

	const scope = gameId ? getGame(gameId).name : 'tous les jeux';
	const intro = `**PraccHub — demandes de pracc (${scope})**\nLes demandes des équipes de tous les serveurs PraccHub apparaissent ici.\n• Pour publier : \`/match chercher\` (ta demande est diffusée tant qu'aucun adversaire n'est trouvé).\n• Pour répondre : discute dans le post, puis clique sur **Accepter le pracc** avec ton équipe (\`/equipe creer\`).`;
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
	levelRange,
	postTitle,
	requestEmbed,
};
