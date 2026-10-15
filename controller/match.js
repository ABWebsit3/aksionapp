const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, userMention } = require('discord.js');
const { getGame, MATCH_TYPES } = require('../config/games');
const { matchEvents, getMatch, teamOf } = require('../services/matchService');
const { hubUrl } = require('../services/hubToken');
const { getCatalog } = require('../services/catalog');

const COLORS = { checkin: 0xff4655, veto: 0xf5a83f, live: 0x3fa9f5, finished: 0x2ecc71, disputed: 0xe67e22, cancelled: 0x7f8c8d };

function hubButtonRow(matchId) {
	return new ActionRowBuilder().addComponents(
		new ButtonBuilder()
			.setCustomId(`hub_open_${matchId}`)
			.setLabel('Ouvrir mon hub')
			.setEmoji('🎮')
			.setStyle(ButtonStyle.Primary),
	);
}

function vetoSummary(match) {
	const { veto, teams } = match;
	if (!veto) return null;
	const names = Object.fromEntries(getCatalog(match.game).items.map(i => [i.id, i.name]));
	const nameOf = id => names[id] || id;
	if (veto.kind === 'maps') {
		const maps = veto.log.filter(e => e.t === 'pick' || e.t === 'decider');
		return maps.map((e, i) => {
			const side = veto.log.find(x => x.t === 'side' && x.mapId === e.id);
			const origin = e.t === 'decider' ? 'décisive' : `pick ${teams[e.team].name}`;
			return `**Map ${i + 1}** : ${nameOf(e.id)} (${origin})${side ? ` — ${teams[side.team].name} : ${side.side}` : ''}`;
		}).join('\n');
	}
	if (veto.kind === 'draft') {
		return ['A', 'B'].map(key => {
			const picks = veto.log.filter(e => e.t === 'pick' && e.team === key).map(e => nameOf(e.id));
			return `**${teams[key].name}** : ${picks.join(', ')}`;
		}).join('\n');
	}
	const side = veto.log.find(e => e.t === 'side');
	return side ? `**Côté** : ${teams[side.team].name} → ${side.side}` : null;
}

/** @param keys équipes à mentionner (['A'], ['B'] ou ['A', 'B'] si elles partagent le salon) */
function buildMessage(match, keys) {
	const game = getGame(match.game);
	const { A, B } = match.teams;
	const embed = new EmbedBuilder()
		.setColor(COLORS[match.status] || 0xff4655)
		.setTitle(`${A.name} vs ${B.name}`)
		.setFooter({ text: `PraccHub • ${game.name} • ${match.format.toUpperCase()} • ${MATCH_TYPES[match.type]}` });

	const mentions = keys.flatMap(key => match.teams[key].members).map(m => userMention(m.id)).join(' ');
	let content = '';
	let components = [hubButtonRow(match.id)];

	switch (match.status) {
	case 'checkin': {
		const deadline = Math.floor(match.checkinDeadline / 1000);
		content = `${mentions}\n🔥 **Adversaire trouvé !** Faites votre check-in sur le hub avant <t:${deadline}:R>.`;
		embed.setDescription(`Niveau : **${game.levels[match.level]}**\nChaque joueur doit cliquer sur **Ouvrir mon hub** puis **Je suis présent**.`);
		break;
	}
	case 'veto':
		content = `${mentions}\n✅ Tout le monde est là ! Pile ou face gagné par **${A.name}**. Le pick & ban commence sur le hub (capitaines).`;
		break;
	case 'live':
		content = `${mentions}\n⚔️ Pick & ban terminé, place au match ! GL HF`;
		embed.setDescription(vetoSummary(match));
		break;
	case 'disputed':
		content = `⚠️ Les capitaines de **${A.name}** et **${B.name}** ont déclaré des résultats différents. Redéclarez le résultat sur le hub ou contactez un admin.`;
		break;
	case 'finished':
		content = `🏆 Victoire de **${match.teams[match.result.winner].name}** ! GG à tous.`;
		components = [];
		break;
	case 'cancelled':
		content = `❌ Match annulé. ${match.cancelReason || ''}`;
		components = [];
		break;
	default:
		return null;
	}
	return { content, embeds: [embed], components };
}

async function notify(client, match) {
	// Si les deux équipes ont cherché depuis le même salon, on ne poste qu'une fois
	const targets = new Map();
	for (const key of ['A', 'B']) {
		const { channelId } = match.teams[key];
		if (channelId) targets.set(channelId, [...(targets.get(channelId) || []), key]);
	}
	for (const [channelId, keys] of targets) {
		const message = buildMessage(match, keys);
		if (!message) continue;
		try {
			const channel = await client.channels.fetch(channelId);
			await channel.send(message);
		}
		catch (error) {
			console.error(`Impossible de notifier le salon ${channelId} :`, error.message);
		}
	}
}

function registerMatchNotifications(client) {
	matchEvents.on('status', ({ match }) => notify(client, match));
}

/** Bouton "Ouvrir mon hub" : renvoie un lien personnel (éphémère) au joueur. */
async function openHub(interaction) {
	const matchId = interaction.customId.replace('hub_open_', '');
	const match = await getMatch(matchId);
	if (!match) return interaction.reply({ content: 'Match introuvable.', ephemeral: true });
	if (!teamOf(match, interaction.user.id)) {
		return interaction.reply({ content: 'Tu ne fais pas partie de ce match.', ephemeral: true });
	}
	const url = hubUrl(match.id, interaction.user.id);
	const row = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setLabel('Accéder au hub').setStyle(ButtonStyle.Link).setURL(url),
	);
	return interaction.reply({
		content: `Voici ton lien personnel (ne le partage pas, il t'identifie) :\n${url}`,
		components: [row],
		ephemeral: true,
	});
}

module.exports = { registerMatchNotifications, openHub, hubButtonRow, buildMessage };
