const { Events } = require('discord.js');
const { userRegistrationforTournament, Tournaments } = require('../controller/tournois');
const { TournamentHelpers } = require('../controller/helpers');

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction) {
		if (interaction.isChatInputCommand()) {
			const command = interaction.client.commands.get(interaction.commandName);


			if (!command) {
				console.error(`No command matching ${interaction.commandName} was found.`);
				return;
			}

			try {
				await command.execute(interaction);
			}
			catch (error) {
				console.error(error);
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
				}
				else {
					await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
				}
			}
		}
		else if (interaction.isAutocomplete()) {
			const command = interaction.client.commands.get(interaction.commandName);

			if (!command) {
				console.error(`No command matching ${interaction.commandName} was found.`);
				return;
			}

			try {
				await command.autocomplete(interaction);
			}
			catch (error) {
				console.error(error);
			}
		}
		else if (interaction.isButton()) {
			if (interaction.customId.startsWith('startSignin_')) {
				Tournaments.startSignInTournament(interaction);
			}
			if (interaction.customId.startsWith('startCheckin_')) {
				Tournaments.startCheckInTournament(interaction);
			}
			if (interaction.customId.startsWith('shuffle_teams_')) {
				Tournaments.randomizeTeams(interaction);
			}
			if (interaction.customId.startsWith('start_')) {
				Tournaments.startTournament(interaction);
			}
     		if (interaction.customId.startsWith('score_')) {
				Tournaments.updateTournament(interaction);
			}
			if (interaction.customId.startsWith('return_')) {
				Tournaments.adminReturnStep(interaction);
			}
			if (interaction.customId.startsWith('lockplayersforteam_')) {
				TournamentHelpers.confirmTeamSelection(interaction);
				
			}
			if (interaction.customId.startsWith('checkin_')) {
				console.log('checkin');
				TournamentHelpers.confirmPlayerCheckIn(interaction);
			}
			
		}
		else if (interaction.isUserSelectMenu()) {

			if (interaction.customId.startsWith('playersforteam_')) {
				Tournaments.addParticipantToTeam(interaction);
			}
		}
	},
};