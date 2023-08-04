const { SlashCommandBuilder } = require('discord.js');
const { models } = require('./../../models');
const { Tournaments } = require('./../../controller/tournois.js');
const { TournamentHelpers } = require('../../controller/helpers');


module.exports = {
	data: new SlashCommandBuilder()
		.setName('dev')
		.setDescription('Commandes Développeur')
		.addSubcommand(subcommand =>
			subcommand.setName('reloadparticipantslist')
				.setDescription('Recharge la lsite des participants')
				.addStringOption(option =>
					option.setName('tournoi')
						.setDescription('Pour quel tournoi ?')
						.setRequired(true).setAutocomplete(true),
				))
		/* .addSubcommand(subcommand =>
			subcommand
				.setName('delete')
				.setDescription('Supprime un tournoi')
				.addStringOption(option => {
					return option.setName('tournoi')
						.setDescription('The channel to echo into')
						.setRequired(true).setAutocomplete(true);
				}),
		)
		.addSubcommand(subcommand =>
			subcommand
				.setName('join')
				.setDescription('Rejoindre un tournois en cours')
				.addStringOption(option => {
					return option.setName('tournoi')
						.setDescription('The channel to echo into')
						.setRequired(true).setAutocomplete(true);
				}),
		) */ ,
	async execute(interaction) {
        
		if (interaction.user.id == '201285952318996480') {

			if (interaction.options._subcommand === 'reloadparticipantslist') {
				const [tournamentId] = interaction.options._hoistedOptions;
				console.log(tournamentId);
				await TournamentHelpers.showRegisteredTeams(interaction, tournamentId.value);
				await interaction.reply({ content: `Liste des participants mis à jour`, ephemeral: true });
			}
		}
		else {
			await interaction.reply('ERREUR : Autorisation refusée');
		}


	},
	async autocomplete(interaction) {

		if (interaction.options._subcommand === 'reloadparticipantslist') {
			console.log('Witch the tournament');
			const result = await models.Tournaments.findAll();
			const choices = result.map(r => { return { name: r.name, value: r.id.toString() }; });
			if (interaction.isAutocomplete()) {
				interaction.respond(choices)
					.catch(console.error);
			}
		}

	},

};

