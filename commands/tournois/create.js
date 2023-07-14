const { SlashCommandBuilder, PermissionsBitField, ChannelType, channelMention } = require('discord.js');
const { models } = require('./../../models');

const { Tournaments } = require('./../../controller/tournois');
const { TournamentHelpers } = require('./../../controller/helpers');


const data = new SlashCommandBuilder()
	.setName('tournoi')
	.setDescription('Commandes "Tournoi"')
	.addSubcommand(subcommand =>
		subcommand.setName('create')
			.setDescription('Créer un tournoi'))
	.addSubcommand(subcommand =>
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
	);


const execute = async function(interaction) {
	if (interaction.options._subcommand === 'create') {
		console.log('Tournament created');

		// Chargement du modal pour la configuration du tournoi
		TournamentHelpers.loadTournamentModal(interaction);
		const filter = (_interaction) => _interaction.customId === 'tournamentSettings';
		interaction.awaitModalSubmit({ filter, time: 15_000 })
			.then(_interaction => initTournament(_interaction))
			.catch(console.error);

	}
	else if (interaction.options._subcommand === 'delete') {

		console.log('delete tournament');
		const tournamentId = interaction.options._hoistedOptions[0].value;
		const tournament = await models.Tournaments.findOne({ where: { id: tournamentId } });
		const tournamentChannels = JSON.parse(tournament.channels);

		tournamentChannels.map(async channel => {
			console.log(channel);
			await interaction.member.guild.channels.delete(channel.id, 'Delete tournaments channels');
		});

		Tournaments.cancelTournament(interaction, tournamentId);
	}
	else if (interaction.options._subcommand === 'join') {

		const tournamentId = interaction.options._hoistedOptions[0].value;
		const Tournament = await TournamentHelpers.getTournament(tournamentId);
		const { ChannelObject } = await TournamentHelpers.getChannel(interaction, tournamentId, 'registeredChannel');

		if (Tournament.status == 'signin') {
			if (Tournament.settings.tournamentType == 'Random teams') {
				await Tournaments.addParticipant(interaction, interaction.user.id, interaction.user.username, tournamentId);
				await TournamentHelpers.showRegisteredUsers(interaction, tournamentId);
				console.log(`User ${interaction.user.username} join tournament`);
				await interaction.reply({ content: `Joueur ${interaction.user.username} inscrit au tournoi : ${tournament.name} \n\t 
				Ton équipe sera annoncé avant le debut du tournoi : ${channelMention(ChannelObject.id)} `, ephemeral: true });
			}
			else {
				TournamentHelpers.loadCreateTeamModal(interaction);
				const filter = (_interaction) => _interaction.customId === 'createTeam';
				interaction.awaitModalSubmit({ filter, time: 15_000 })
					.then(_interaction => Tournament.createTeam(_interaction, tournamentId))
					.catch(console.error);
			}


		}
		else if (Tournament.status == 'waiting') {
			await interaction.reply({ content: 'L\'inscription au tournoi n\'est pas ouvert.', ephemeral: true });
		}
		else if (Tournament.status == 'checkin') {
			await interaction.reply({ content: 'Inscription terminé ! Le tournoi va bientôt commencer !', ephemeral: true });
		}
		else if (Tournament.status == 'started') {
			await interaction.reply({ content: 'Inscription terminé ! Le tournoi à déjà commencé !', ephemeral: true });
		}
		else {
			await interaction.reply({ content: 'Erreur inconnu ! Contacter un admin !', ephemeral: true });
		}


	}

	// interaction.user is the object representing the User who ran the command
	// interaction.member is the GuildMember object, which represents the user in the specific guild

};


const autocomplete = async function(interaction) {

	if (interaction.options._subcommand === 'delete') {
		console.log('Witch the tournament');
		const result = await models.Tournaments.findAll();
		const choices = result.map(r => { return { name: r.name, value: r.id.toString() }; });
		if (interaction.isAutocomplete()) {
			interaction.respond(choices)
				.catch(console.error);
		}
	}
	if (interaction.options._subcommand === 'join') {
		console.log('Witch the tournament');
		const result = await models.Tournaments.findAll();
		const choices = result.map(r => { return { name: r.name, value: r.id.toString() }; });
		if (interaction.isAutocomplete()) {
			interaction.respond(choices)
				.catch(console.error);
		}
	}

};


/** ******************************************** */

const initTournament = async function(interaction) {

	if (interaction.customId === 'tournamentSettings') {
		await interaction.deferReply({ ephemeral: true });
		const tournamentName = interaction.fields.getTextInputValue('tournamentName');
		const tournamentTeamSize = parseInt(interaction.fields.getTextInputValue('tournamentTeamsize'));
		if (tournamentTeamSize >= 1 && tournamentTeamSize <= 5) {
			const tournament = await models.Tournaments.create({
				name: tournamentName,
				teamsSize: tournamentTeamSize,
			});

			const role = await interaction.member.guild.roles.create({ name: tournamentName });

			const groupChannel = await TournamentHelpers.createChannel(interaction, { type: ChannelType.GuildCategory, name: tournamentName });
			const registeredChannel = await TournamentHelpers.createChannel(interaction, { name: 'Participants', parent: groupChannel.id });
			const lobbyChannel = await TournamentHelpers.createChannel(interaction, { name: 'Lobby', reason: 'Lobby for players', parent: groupChannel.id });
			const scoreChannel = await TournamentHelpers.createChannel(interaction, {
				name: 'Score',
				reason: 'Lobby for players',
				parent: groupChannel.id,
				permissionOverwrites: [
					{
						id: interaction.guild.id,
						deny: [PermissionsBitField.Flags.ViewChannel],
					},
					{
						id: role.id,
						allow: [PermissionsBitField.Flags.ViewChannel],
					},
				],
			});
			const adminChannel = await TournamentHelpers.createChannel(interaction, {
				name: 'Administration',
				reason: 'Lobby for players',
				parent: groupChannel.id,
				permissionOverwrites: [
					{
						id: interaction.guild.id,
						deny: [PermissionsBitField.Flags.ViewChannel],
					},
				],
			});

			const channelGroup = [
				{
					name: 'lobbyChannel',
					id: lobbyChannel.id,
				},
				{
					name: 'registeredChannel',
					id: registeredChannel.id,
				},
				{
					name: 'scoreChannel',
					id: scoreChannel.id,
				},
				{
					name: 'adminChannel',
					id: adminChannel.id,
				},
				{
					name: 'groupChannel',
					id: groupChannel.id,
				},

			];

			const settings = {
				TournamentType : 'Random teams',
				TeamsSizes: '5',
				ConsolationRound : 'true',
			};

			await models.Tournaments.update({
				guildId: groupChannel.guildId,
				channels: JSON.stringify(channelGroup),
				settings: JSON.stringify(settings),
				roleId: role.id,
			}, {
				where: {
					id: tournament.id,
				},
			});

			TournamentHelpers.showTournamentSettings(interaction, tournament.id);
			await interaction.editReply({ content: 'Tournoi créé', ephemeral: true });

			TournamentHelpers.adminsControlsButtons(interaction, tournament.id);
		}
		else {
			await interaction.editReply({ content: 'Erreur ! La taille des équipe doit être compris entre 1 et 5', ephemeral: true });
		}


	}

};


module.exports = {
	data: data,
	execute,
	autocomplete,
};
