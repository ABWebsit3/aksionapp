const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { models } = require('../../models');
const { getGame, MATCH_TYPES } = require('../../config/games');
const { search, cancelSearch, QUEUE_TTL_MS } = require('../../services/matchmaking');
const { hubUrl } = require('../../services/hubToken');
const { teamChoices } = require('./equipe');

const data = new SlashCommandBuilder()
	.setName('match')
	.setDescription('Trouver un match ou un scrim avec PraccHub')
	.addSubcommand(sub => sub
		.setName('chercher')
		.setDescription('Chercher un adversaire de ton niveau')
		.addStringOption(o => o.setName('equipe').setDescription('Ton équipe').setRequired(true).setAutocomplete(true))
		.addStringOption(o => o.setName('niveau').setDescription('Niveau de ton équipe').setRequired(true).setAutocomplete(true))
		.addStringOption(o => o.setName('type').setDescription('Type de rencontre (défaut : scrim)')
			.addChoices(...Object.entries(MATCH_TYPES).map(([value, name]) => ({ name, value }))))
		.addStringOption(o => o.setName('format').setDescription('Format (défaut : BO1)')
			.addChoices({ name: 'BO1', value: 'bo1' }, { name: 'BO3', value: 'bo3' }, { name: 'BO5', value: 'bo5' }))
		.addIntegerOption(o => o.setName('ecart').setDescription('Écart de niveau accepté (défaut : 1)').setMinValue(0).setMaxValue(3)))
	.addSubcommand(sub => sub
		.setName('annuler')
		.setDescription('Annuler la recherche de ton équipe')
		.addStringOption(o => o.setName('equipe').setDescription('Ton équipe').setRequired(true).setAutocomplete(true)))
	.addSubcommand(sub => sub
		.setName('hub')
		.setDescription('Obtenir ton lien vers le hub de ton match en cours'));

async function execute(interaction) {
	const sub = interaction.options.getSubcommand();
	try {
		if (sub === 'chercher') {
			const team = await models.MatchTeams.findByPk(parseInt(interaction.options.getString('equipe')) || 0);
			if (!team || team.captainId !== interaction.user.id) throw new Error('Seul le capitaine peut lancer une recherche pour son équipe.');
			const game = getGame(team.game);
			const level = parseInt(interaction.options.getString('niveau'));
			if (!(level >= 0 && level < game.levels.length)) throw new Error('Niveau invalide, choisis-le dans la liste proposée.');

			await interaction.deferReply();
			const result = await search({
				team,
				format: interaction.options.getString('format') || 'bo1',
				type: interaction.options.getString('type') || 'scrim',
				level,
				tolerance: interaction.options.getInteger('ecart') ?? 1,
				channelId: interaction.channelId,
				guildId: interaction.guildId,
				requestedBy: interaction.user.id,
			});
			if (result.status === 'matched') {
				return interaction.editReply('🎯 Adversaire trouvé ! Les infos du match arrivent juste en dessous.');
			}
			const minutes = Math.round(QUEUE_TTL_MS / 60000);
			return interaction.editReply(`🔎 **${team.name}** recherche un ${MATCH_TYPES[result.entry.type].toLowerCase()} ${game.name} (${result.entry.format.toUpperCase()}, niveau ${game.levels[level]}). Je préviens ce salon dès qu'un adversaire est trouvé (recherche valable ${minutes} min).`);
		}

		if (sub === 'annuler') {
			const team = await models.MatchTeams.findByPk(parseInt(interaction.options.getString('equipe')) || 0);
			if (!team || team.captainId !== interaction.user.id) throw new Error('Seul le capitaine peut annuler la recherche.');
			const removed = await cancelSearch(team.id);
			return interaction.reply({ content: removed ? '🛑 Recherche annulée.' : 'Ton équipe n\'était pas en recherche.', ephemeral: true });
		}

		if (sub === 'hub') {
			const matches = await models.Matches.findAll({ where: { status: ['checkin', 'veto', 'live', 'disputed'] } });
			const mine = matches.filter(m => {
				const { teams } = JSON.parse(m.data);
				return [...teams.A.members, ...teams.B.members].some(p => p.id === interaction.user.id);
			});
			if (!mine.length) throw new Error('Tu n\'as aucun match en cours.');
			const row = new ActionRowBuilder().addComponents(mine.slice(0, 5).map(m => {
				const { teams } = JSON.parse(m.data);
				return new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(hubUrl(m.id, interaction.user.id)).setLabel(`${teams.A.name} vs ${teams.B.name}`.slice(0, 80));
			}));
			return interaction.reply({ content: 'Tes matchs en cours (liens personnels, ne les partage pas) :', components: [row], ephemeral: true });
		}
	}
	catch (error) {
		const payload = { content: `❌ ${error.message}`, ephemeral: true };
		return interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload);
	}
}

async function autocomplete(interaction) {
	const focused = interaction.options.getFocused(true);
	if (focused.name === 'equipe') {
		return interaction.respond(await teamChoices(interaction, { captainOnly: true }));
	}
	if (focused.name === 'niveau') {
		const team = await models.MatchTeams.findByPk(parseInt(interaction.options.getString('equipe')) || 0);
		if (!team) return interaction.respond([{ name: 'Choisis d\'abord ton équipe', value: '-1' }]);
		const query = focused.value.toLowerCase();
		const choices = getGame(team.game).levels
			.map((name, index) => ({ name, value: index.toString() }))
			.filter(c => c.name.toLowerCase().includes(query));
		return interaction.respond(choices.slice(0, 25));
	}
	return interaction.respond([]);
}

module.exports = { data, execute, autocomplete };
