const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, channelMention } = require('discord.js');
const { models } = require('../../models');
const { GAMES, getGame } = require('../../config/games');
const { configureBoard } = require('../../controller/praccBoard');

const data = new SlashCommandBuilder()
	.setName('pracc')
	.setDescription('Configurer le salon des demandes de pracc de ce serveur')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.setDMPermission(false)
	.addSubcommand(sub => sub
		.setName('salon')
		.setDescription('Choisir le salon (forum recommandé) où les demandes de pracc apparaissent')
		.addChannelOption(o => o.setName('salon').setDescription('Forum ou salon textuel').setRequired(true)
			.addChannelTypes(ChannelType.GuildForum, ChannelType.GuildText, ChannelType.GuildAnnouncement))
		.addStringOption(o => o.setName('jeu').setDescription('Limiter à un jeu (défaut : tous)')
			.addChoices(...Object.values(GAMES).map(g => ({ name: g.name, value: g.id })))))
	.addSubcommand(sub => sub
		.setName('retirer')
		.setDescription('Ne plus recevoir les demandes de pracc sur ce serveur'))
	.addSubcommand(sub => sub
		.setName('voir')
		.setDescription('Afficher la configuration et les demandes ouvertes'));

async function execute(interaction) {
	const sub = interaction.options.getSubcommand();
	try {
		if (sub === 'salon') {
			const channel = interaction.options.getChannel('salon');
			const gameId = interaction.options.getString('jeu');
			await interaction.deferReply({ ephemeral: true });
			const { tagsOk, backfilled } = await configureBoard(interaction, channel, gameId);
			const lines = [
				`✅ Les demandes de pracc (${gameId ? getGame(gameId).name : 'tous les jeux'}) seront publiées dans ${channelMention(channel.id)}.`,
				backfilled ? `📬 ${backfilled} demande(s) déjà ouverte(s) viennent d'y être publiées.` : '📭 Aucune demande ouverte pour l\'instant.',
			];
			if (!tagsOk) lines.push('ℹ️ Je n\'ai pas pu créer les tags du forum (permission « Gérer les salons » manquante). Les posts seront publiés sans tags.');
			return interaction.editReply(lines.join('\n'));
		}
		if (sub === 'retirer') {
			await models.GuildSettings.upsert({ guildId: interaction.guildId, praccChannelId: null, praccGame: null });
			return interaction.reply({ content: '🛑 Ce serveur ne reçoit plus les demandes de pracc.', ephemeral: true });
		}
		if (sub === 'voir') {
			const settings = await models.GuildSettings.findByPk(interaction.guildId);
			const open = await models.QueueEntries.count();
			const where = settings && settings.praccChannelId
				? `${channelMention(settings.praccChannelId)} (${settings.praccGame ? getGame(settings.praccGame).name : 'tous les jeux'})`
				: 'aucun salon configuré (`/pracc salon`)';
			return interaction.reply({ content: `**Salon des demandes de pracc** : ${where}\n**Demandes ouvertes sur PraccHub** : ${open}`, ephemeral: true });
		}
	}
	catch (error) {
		const payload = { content: `❌ ${error.message}`, ephemeral: true };
		return interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload);
	}
}

module.exports = { data, execute };
