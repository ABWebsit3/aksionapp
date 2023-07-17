const { JsonDatabase } = require('brackets-json-db');
const { BracketsManager } = require('brackets-manager');
const { EmbedBuilder, userMention } = require('discord.js');
const { TournamentHelpers } = require('./helpers.js');
const { TOURNAMENTTYPE } = require('../utils/utils.js');
const { models } = require('../models');

const fs = require('fs');

const storage = new JsonDatabase();
const manager = new BracketsManager(storage);

// Tournaments states = waiting - signin - checkin - started - finished(optionnal)

const Tournaments = {

	randomizeTeams: async function(interaction) {

		const tournament_id = interaction.customId.replace('shuffle_teams_', '');

		const tournament = await models.Tournaments.findOne({ where: { id: tournament_id } });
		const Channels = JSON.parse(tournament.channels);
		const registeredChannel = Channels.filter(data => data.name === 'registeredChannel')[0];
		const registeredChannelObject = interaction.client.channels.cache.get(registeredChannel.id);

		const webhooks = await registeredChannelObject.fetchWebhooks();
		const webhook = webhooks.first();


		const messages = await registeredChannelObject.messages.fetch();

		if (Array.from(messages.values()).length) {
			const webhookMessages = messages.find(m => m.webhookId == webhook.id);
			console.log(webhookMessages);
			await webhook.deleteMessage(webhookMessages.id);
		}


		let participants = await models.Participants.findAll({ where: { tournamentId: tournament_id } });
		if (participants.length % tournament.teamsSize) {
			console.log(`Il reste : ${participants.length % tournament.teamsSize}`);
			participants = participants.slice(0, participants.length - participants.length % tournament.teamsSize);
		}

		let teamNum = 1;

		const shuffledParticipants = participants.map(value => ({ value: value, sort: Math.random() }))
			.sort((a, b) => a.sort - b.sort)
			.map(({ value }) => value);

		for (let j = 0; j < shuffledParticipants.length; j += 25) {
			const slicedData = shuffledParticipants.slice(j, j + 25);
			const ParticipantsEmbed = new EmbedBuilder()
				.setColor(0x0099FF)
				.setTitle('Liste des équipes');

			for (let i = 0; i < slicedData.length; i += tournament.teamsSize) {

				const teamData = slicedData.slice(i, i + tournament.teamsSize);
				const team = await models.Teams.create({
					name: `Équipe ${teamNum}`,
					tournamentId: tournament_id,
				});

				let text = '';
				await teamData.forEach(async player => {
					if (player.user_id) {
						text += `${userMention(player.user_id)}
								`;
					}
					else {
						text += `${player.name}
							`;
					}
					await models.Participants.update({
						teamId: team.id,
					}, {
						where: {
							name: player.name,
						},
					});


				});

				ParticipantsEmbed.addFields({ name: `Équipe ${teamNum}`, value: text });
				teamNum++;
			}
			webhook.send({ embeds : [ParticipantsEmbed] });
		}


		await interaction.reply({ content: 'Équipes créées, Mise à jour du tableau des participants', ephemeral: true });

	},
	createTeam: async function(interaction, tournamentId) {
		const { ChannelObject : AdminChannel } = await TournamentHelpers.getChannel(interaction, tournamentId, 'adminChannel');
		const { Tournament } = await TournamentHelpers.getTournament(tournamentId);
		const row = new ActionRowBuilder();
		for (let i = 1; i <= Tournament.settings.teamSize; i++) {
			const select = new userSelectMenuBuilder()
				.setCustomId('starter')
				.setPlaceholder(`Joueur ${i}`);

			row.addComponents(select);
		}


		await AdminChannel.send({
			content: 'Créer ton équipe : Le premier joueur inscrit sera le capitaine.',
			components: [row],
		});
	},
	startTournament: async function(interaction) {
		const tournament_id = parseInt(interaction.customId.replace('start_', ''));
		const { webhook, Tournament, ChannelObject: ScoreChannel } = await TournamentHelpers.getChannel(interaction, tournament_id, 'scoreChannel');
		const { ChannelObject: LobbyChannel } = await TournamentHelpers.getChannel(interaction, tournament_id, 'lobbyChannel');
		const TournamentSettings = JSON.parse(Tournament.settings);
		if (Tournament) {

			const teams = await models.Teams.findAll({
				where: {
					tournamentId: tournament_id,
				},
			});

			let tournamentSize = 1;

			while (tournamentSize < teams.length) {
				tournamentSize *= 2;
			}

			if (tournamentSize != teams.length) {
				const rest = tournamentSize - teams.length;
				for (let i = 0; i < rest; i++) {
					await teams.push({ name:null });
				}
			}

			await manager.create({
				tournamentId: tournament_id,
				name: Tournament.name,
				type: TournamentSettings.TournamentType.config,
				seeding:  teams.map(team => team.name),
				settings: {
					// consolationFinal: true,
					balanceByes: true,
				},
			});

			TournamentHelpers.showMatchThreads(tournament_id, manager, webhook, ScoreChannel);
			await models.Tournaments.update({ status: 'started' }, { where: { id: tournament_id } });

			LobbyChannel.send({ content: 'Tournoi démarré ! GL HF ' });
			// console.log(current_match)
		}
		else {
			await interaction.reply({ content: 'Tournoi déjà démarré', ephemeral: true });
		}

	},
	updateTournament: async function(interaction) {

		const [ tournamentId, match_id ] = interaction.customId.replace('score_', '').split('_');
		const bracket = await manager.get.tournamentData(parseInt(tournamentId));

		// Si le score n'est pas déjà entré, on continue !
		const scoreSetted = bracket.match.filter(match => match.id == match_id && match.status == 2);

		if (scoreSetted.length) {
			TournamentHelpers.setMatchScore(interaction, bracket, parseInt(match_id));

			const filter = (_interaction) => _interaction.customId === 'matchScore';
			interaction.awaitModalSubmit({ filter, time: 15_000 })
				.then(async _interaction => {
					// console.log(_interaction);

					const opponents = {
						1: {
							name : bracket.participant.filter(participant => participant.id == scoreSetted[0].opponent1.id).name,
							score : parseInt(_interaction.fields.getTextInputValue('opponent1')),
						},
						2: {
							name : bracket.participant.filter(participant => participant.id == scoreSetted[0].opponent2.id).name,
							score: parseInt(_interaction.fields.getTextInputValue('opponent2')),
						},
					};

					if (opponents['1'].score > opponents['2'].score) {
						opponents['1'].result = 'win';
					}
					else {
						opponents['2'].result = 'win';
					}

					await manager.update.match({
						id:  parseInt(match_id),
						opponent1: opponents['1'],
						opponent2: opponents['2'],
					});

					await _interaction.reply({ content: 'Score mis à jour', ephemeral: true });

					// On check si des matchs sont encore en cours avec le statut 2
					const bracketupdated = await manager.get.tournamentData(parseInt(tournamentId));
					const roundEnded = bracketupdated.match.filter(match => match.id == match_id && match.status == 2);
					console.log(roundEnded);

					// Si aucun match on mets à jour la liste des threads pour les matchs
					if (!roundEnded.length) {
						console.log('dernier match du round joué');
						TournamentHelpers.updateMatchThreads(interaction, tournamentId, manager, opponents);
						// Si dernier match du tournoi: finir tounroi et afficher vainqueur
						// Utiliser données de opponents pour afficher le gagnant !
					}

				})
				.catch(console.error);
		}
		else {
			await interaction.reply({ content: 'Le score de ce match à déjà été entré !', ephemeral: true });
		}


	},
	startSignInTournament: async function(interaction) {
		const tournamentId = interaction.customId.replace('signin_', '');
		await models.Tournaments.update({ status : 'signin' }, { where : { id : tournamentId } });
		await TournamentHelpers.adminsControlsButtons(interaction, tournamentId, 'signin');
		console.log('Tournament status updated : Sign In');
	},
	startCheckInTournament: async function(interaction) {
		const tournamentId = interaction.customId.replace('checkin_', '');
		await models.Tournaments.update({ status : 'checkin' }, { where : { id : tournamentId } });
		await TournamentHelpers.adminsControlsButtons(interaction, tournamentId, 'checkin');
		console.log('Tournament status updated : Check In');
	},
	adminReturnStep: async function(interaction) {
		const tournamentId = interaction.customId.replace('return_', '');
		await models.Tournaments.update({ status : 'signin' }, { where : { id : tournamentId } });
		await TournamentHelpers.adminsControlsButtons(interaction, tournamentId, 'signin');
		console.log('Tournament status updated : Sign In (Return step)');
	},
	addParticipant: async function(interaction, user_id, name, tournamentId, fake = false) {
		const Tournament = await TournamentHelpers.getTournament(tournamentId);
		const participantCheck = models.Participants.findOne({ where : { user_id: user_id, tournamentId: parseInt(tournamentId) } });

		// Si le joueur n'est pas déjà enregistré
		if (!participantCheck.length) {
			await models.Participants.create({ user_id: user_id, name: name, tournamentId: parseInt(tournamentId) });
			// console.log(interaction)
			if (!fake) {
				const role = await interaction.member.guild.roles.fetch(Tournament.roleId);
				await interaction.member.roles.add(role);
			}
		}
		else {
			interaction.reply({ content: 'Vous êtes déjà inscrit au tournoi !', ephemeral: true });
		}

	},
	removeParticipant: async function(interaction, user_id, tournamentId) {
		const Tournament = await TournamentHelpers.getTournament(tournamentId);
		const role = await interaction.member.guild.roles.fetch(Tournament.roleId);
		await interaction.member.roles.delete(role);
		await models.Participants.destroy({ where: { user_id: user_id, tournamentId: parseInt(tournamentId) } });
	},
	cancelTournament: async function(interaction, tournamentId) {
		await models.Tournaments.destroy({ where: { id: parseInt(tournamentId) } });
		await manager.delete.tournament(tournamentId);
		await interaction.reply('Tournoi supprimé.');

	},
};


module.exports = { Tournaments };