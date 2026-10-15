const { SlashCommandBuilder, EmbedBuilder, userMention } = require('discord.js');
const { Op } = require('sequelize');
const { models } = require('../../models');
const { GAMES, getGame } = require('../../config/games');

// Remplaçants autorisés en plus des titulaires
const MAX_SUBS = 2;

const data = new SlashCommandBuilder()
	.setName('equipe')
	.setDescription('Gérer tes équipes PraccHub')
	.addSubcommand(sub => sub
		.setName('creer')
		.setDescription('Créer une équipe (tu en deviens le capitaine)')
		.addStringOption(o => o.setName('nom').setDescription('Nom de l\'équipe').setRequired(true).setMaxLength(32))
		.addStringOption(o => o.setName('jeu').setDescription('Jeu').setRequired(true)
			.addChoices(...Object.values(GAMES).map(g => ({ name: g.name, value: g.id }))))
		.addIntegerOption(o => o.setName('taille').setDescription('Joueurs par équipe (Rocket League : 1, 2 ou 3)').setMinValue(1).setMaxValue(5)))
	.addSubcommand(sub => sub
		.setName('ajouter')
		.setDescription('Ajouter un joueur à ton équipe')
		.addStringOption(o => o.setName('equipe').setDescription('Équipe').setRequired(true).setAutocomplete(true))
		.addUserOption(o => o.setName('joueur').setDescription('Joueur à ajouter').setRequired(true)))
	.addSubcommand(sub => sub
		.setName('retirer')
		.setDescription('Retirer un joueur de ton équipe')
		.addStringOption(o => o.setName('equipe').setDescription('Équipe').setRequired(true).setAutocomplete(true))
		.addUserOption(o => o.setName('joueur').setDescription('Joueur à retirer').setRequired(true)))
	.addSubcommand(sub => sub
		.setName('info')
		.setDescription('Afficher une équipe')
		.addStringOption(o => o.setName('equipe').setDescription('Équipe').setRequired(true).setAutocomplete(true)))
	.addSubcommand(sub => sub
		.setName('supprimer')
		.setDescription('Supprimer ton équipe')
		.addStringOption(o => o.setName('equipe').setDescription('Équipe').setRequired(true).setAutocomplete(true)));

const displayName = user => user.globalName || user.username;

async function captainTeam(interaction) {
	const team = await models.MatchTeams.findByPk(parseInt(interaction.options.getString('equipe')) || 0);
	if (!team || team.captainId !== interaction.user.id) {
		throw new Error('Équipe introuvable ou tu n\'en es pas le capitaine.');
	}
	return team;
}

async function execute(interaction) {
	const sub = interaction.options.getSubcommand();
	try {
		if (sub === 'creer') {
			const game = getGame(interaction.options.getString('jeu'));
			const size = interaction.options.getInteger('taille') || game.sizes[game.sizes.length - 1];
			if (!game.sizes.includes(size)) {
				throw new Error(`Taille invalide pour ${game.name} : ${game.sizes.join(', ')} joueur(s).`);
			}
			const team = await models.MatchTeams.create({
				name: interaction.options.getString('nom'),
				game: game.id,
				size,
				captainId: interaction.user.id,
				guildId: interaction.guildId,
				members: JSON.stringify([{ id: interaction.user.id, name: displayName(interaction.user) }]),
			});
			return interaction.reply({
				content: `✅ Équipe **${team.name}** créée pour ${game.name} (${size}v${size}). Ajoute tes joueurs avec \`/equipe ajouter\`.`,
				ephemeral: true,
			});
		}

		if (sub === 'ajouter' || sub === 'retirer') {
			const team = await captainTeam(interaction);
			const user = interaction.options.getUser('joueur');
			let members = JSON.parse(team.members);
			if (sub === 'ajouter') {
				if (user.bot) throw new Error('Impossible d\'ajouter un bot.');
				if (members.some(m => m.id === user.id)) throw new Error('Ce joueur est déjà dans l\'équipe.');
				if (members.length >= team.size + MAX_SUBS) throw new Error(`Équipe complète (${team.size} titulaires + ${MAX_SUBS} remplaçants).`);
				members.push({ id: user.id, name: displayName(user) });
			}
			else {
				if (user.id === team.captainId) throw new Error('Le capitaine ne peut pas être retiré. Supprime l\'équipe à la place.');
				members = members.filter(m => m.id !== user.id);
			}
			await team.update({ members: JSON.stringify(members) });
			return interaction.reply({
				content: `${sub === 'ajouter' ? '➕' : '➖'} ${userMention(user.id)} ${sub === 'ajouter' ? 'ajouté à' : 'retiré de'} **${team.name}** (${members.length}/${team.size}).`,
				ephemeral: true,
			});
		}

		if (sub === 'info') {
			const team = await models.MatchTeams.findByPk(parseInt(interaction.options.getString('equipe')) || 0);
			if (!team) throw new Error('Équipe introuvable.');
			const game = getGame(team.game);
			const members = JSON.parse(team.members);
			const embed = new EmbedBuilder()
				.setColor(0xff4655)
				.setTitle(team.name)
				.setDescription(`${game.name} • ${team.size}v${team.size}`)
				.addFields({
					name: `Joueurs (${members.length})`,
					value: members.map(m => `${userMention(m.id)}${m.id === team.captainId ? ' 👑' : ''}`).join('\n'),
				});
			return interaction.reply({ embeds: [embed], ephemeral: true });
		}

		if (sub === 'supprimer') {
			const team = await captainTeam(interaction);
			await models.QueueEntries.destroy({ where: { teamId: team.id } });
			await team.destroy();
			return interaction.reply({ content: `🗑️ Équipe **${team.name}** supprimée.`, ephemeral: true });
		}
	}
	catch (error) {
		return interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
	}
}

/** Autocomplete : équipes dont l'utilisateur est capitaine (ou membre pour /equipe info). */
async function teamChoices(interaction, { captainOnly }) {
	const focused = interaction.options.getFocused().toLowerCase();
	const where = captainOnly
		? { captainId: interaction.user.id }
		: { members: { [Op.like]: `%"id":"${interaction.user.id}"%` } };
	const teams = await models.MatchTeams.findAll({ where, limit: 50 });
	return teams
		.filter(t => t.name.toLowerCase().includes(focused))
		.slice(0, 25)
		.map(t => ({ name: `${t.name} — ${getGame(t.game).name} ${t.size}v${t.size}`, value: t.id.toString() }));
}

async function autocomplete(interaction) {
	const sub = interaction.options.getSubcommand();
	await interaction.respond(await teamChoices(interaction, { captainOnly: sub !== 'info' }));
}

module.exports = { data, execute, autocomplete, teamChoices };
