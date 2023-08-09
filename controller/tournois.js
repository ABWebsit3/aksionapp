const { JsonDatabase } = require('brackets-json-db');
const { BracketsManager } = require('brackets-manager');
const { EmbedBuilder, userMention, ActionRowBuilder, UserSelectMenuBuilder, ChannelType, spoiler, ButtonBuilder, ButtonStyle, channelMention, PermissionsBitField, roleMention } = require('discord.js');
const { TournamentHelpers } = require('./helpers.js');
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
	createTeam: async function(interaction, tournamentId, DMchannel) {
		await interaction.deferReply({ ephemeral: true });
		const { webhook, ChannelObject : RegisteredChannel } = await TournamentHelpers.getChannel(interaction, tournamentId, 'registeredChannel', 'signin');
		// On vide les message en DM ! EUREKA !
		// DMchannel.messages.fetch().then(messages => messages.map(m => {m.delete();}));

		const Tournament = await TournamentHelpers.getTournament(tournamentId);

		const teamName = interaction.fields.getTextInputValue('teamName');
		const team = await models.Teams.create({
			name: teamName,
			tournamentId: tournamentId,
		});

		const thread = await RegisteredChannel.threads.create({
			name: `Équipe : ${teamName}`,
			autoArchiveDuration: 60,
			type : ChannelType.PrivateThread,
			reason: 'Needed a separate thread for moderation',
		});
		console.log(thread.joinable);
		if (thread.joinable) await thread.join();


		const select = new UserSelectMenuBuilder()
			.setCustomId(`playersforteam_${tournamentId}_${team.id}_${thread.id}`)
			.setPlaceholder('Joueurs')
			.setMinValues(parseInt(Tournament.settings.TeamsSizes))
			.setMaxValues(parseInt(Tournament.settings.TeamsSizes));


		const selectrow = new ActionRowBuilder().addComponents(select);


		await webhook.send({
			content: `${spoiler(userMention(interaction.user.id))}
Équipe : ${teamName}
Inscription au tournoi : ${Tournament.name}
Créer ton équipe : Ajoute les ${parseInt(Tournament.settings.TeamsSizes)} joueurs (Ne t'oublie pas!)
Une fois que tu as sélectionné les joueurs clique sur "Confirmer les joueurs"`,
			components: [selectrow],
			threadId: thread.id,
		});

		await interaction.editReply({ content: `Vous pouvez créer votre équipe ! ${channelMention(thread.id)}`, ephemeral: true });

	},
	CheckIn: async function(interaction, tournamentId) {

		const participants = await models.Participants.findAll({ where: { tournamentId: tournamentId } });
		console.log(participants);
		for (const p of participants) {
			const user = await interaction.client.users.fetch(p.user_id.toString());

			// 201285952318996480 MON ID USER
			// const user = await interaction.client.users.fetch('201285952318996480');
			const checkInButton = new ButtonBuilder()
				.setCustomId('checkin_' + user.id)
				.setLabel('✅ Check-In')
				.setStyle(ButtonStyle.Success);

			const row = new ActionRowBuilder()
				.addComponents([checkInButton]);

			user.send({
				content: 'Confirmer votre présence en cliquant sur le button "Check-In".',
				components: [row],
			});
		}

	},
	startTournament: async function(interaction) {
		const tournament_id = parseInt(interaction.customId.replace('start_', ''));
		const { webhook, Tournament, ChannelObject: ScoreChannel } = await TournamentHelpers.getChannel(interaction, tournament_id, 'scoreChannel');
		const { ChannelObject: LobbyChannel } = await TournamentHelpers.getChannel(interaction, tournament_id, 'lobbyChannel');

		if (Tournament) {

			const teams = await models.Teams.findAll({
				include: {
					model: models.Participants,
					where: {
					  checkin: 1,
					  tournamentId: tournament_id,
					},
				  },
			});
			if (teams.length >= 2) {
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
					type: Tournament.settings.TournamentType.config,
					seeding:  teams.map(team => team.name),
					settings: {
						// consolationFinal: true,
						balanceByes: true,
					},
				});

				TournamentHelpers.showMatchThreads(tournament_id, manager, webhook, ScoreChannel);
				await models.Tournaments.update({ status: 'started' }, { where: { id: tournament_id } });

				LobbyChannel.send({ content: 'Tournoi démarré ! GL HF ' });
			}
			else {
				await interaction.reply({ content: 'Un minimum de deux équipes est nécessaire pour lancer le tournoi \n\t Les joueurs ont-ils fait leur check-in ?', ephemeral: true });
			}

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

					const currentStage = await manager.get.currentStage(parseInt(tournamentId));
					const currentRound = await manager.get.currentRound(currentStage.id);
					console.log(currentRound);

					await manager.update.match({
						id:  parseInt(match_id),
						opponent1: opponents['1'],
						opponent2: opponents['2'],
					});
					await _interaction.reply({ content: 'Score mis à jour', ephemeral: true });

					// On check si des matchs sont encore en cours avec le statut 2
					const bracketupdated = await manager.get.tournamentData(parseInt(tournamentId));
					const roundEnded = bracketupdated.match.filter(match => match.round_id == currentRound.id && match.status == 2);

					// Si aucun match on mets à jour la liste des threads pour les matchs
					if (!roundEnded.length) {
						console.log('dernier match du round joué');
						// await manager.get.finalStandings(stage.id)
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
		const tournamentId = interaction.customId.replace('startSignin_', '');
		const { webhook, Tournament } = await TournamentHelpers.getChannel(interaction, tournamentId, 'lobbyChannel');
		await models.Tournaments.update({ status : 'signin' }, { where : { id : tournamentId } });
		await TournamentHelpers.adminsControlsButtons(interaction, tournamentId, 'signin');
		webhook.send(`Les inscriptions pour le tournoi ${Tournament.name} sont ouvert !`);
		console.log('Tournament status updated : Sign In');
	},
	startCheckInTournament: async function(interaction) {
		const tournamentId = interaction.customId.replace('startCheckin_', '');
		const { ChannelObject : groupChannel, Tournament } = await TournamentHelpers.getChannel(interaction, tournamentId, 'groupChannel');
		const { webhook: lobbyWebhook } = await TournamentHelpers.getChannel(interaction, tournamentId, 'lobbyChannel');
		const checkinChannel = await TournamentHelpers.createChannel(interaction, {
			name: 'Check In',
			reason: 'Check-in channel',
			parent: groupChannel.id,
			position: 2,
			permissionOverwrites: [
				{
					id: interaction.guild.id,
					deny: [PermissionsBitField.Flags.ViewChannel],
				},
				{
					id: Tournament.roleId,
					allow: [PermissionsBitField.Flags.ViewChannel],
					deny: [PermissionsBitField.Flags.SendMessages],
				},
			],
		});

		const checkInButton = new ButtonBuilder()
			.setCustomId('checkin_' + Tournament.id)
			.setLabel('✅ Check-In')
			.setStyle(ButtonStyle.Success);

		const row = new ActionRowBuilder()
			.addComponents([checkInButton]);

		checkinChannel.send({
			content: `${roleMention(Tournament.roleId)}
Confirmer votre présence en cliquant sur le button "Check-In".`,
			components: [row],
		});

		const channels = JSON.parse(Tournament.channels);
		channels.push({
			name: 'checkinChannel',
			id: checkinChannel.id,
		});

		await models.Tournaments.update({
			status : 'checkin',
			channels: JSON.stringify(channels),
		}, { where : { id : tournamentId } });

		await TournamentHelpers.adminsControlsButtons(interaction, tournamentId, 'checkin');

		lobbyWebhook.send(`Les inscriptions pour le tournoi ${Tournament.name} sont fermé !
Le Check-In est ouvert ! Confirmez votre présence pour participer.`);
		interaction.reply('Les inscriptions pour le tournoi sont fermé ! Le Check-In est ouvert !');
		console.log('Tournament status updated : Check In');
	},

	adminReturnStep: async function(interaction) {
		const tournamentId = interaction.customId.replace('return_', '');
		const { webhook, Tournament } = await TournamentHelpers.getChannel(interaction, tournamentId, 'lobbyChannel');
		await models.Tournaments.update({ status : 'signin' }, { where : { id : tournamentId } });
		await TournamentHelpers.adminsControlsButtons(interaction, tournamentId, 'signin');
		webhook.send(`Les inscriptions pour le tournoi ${Tournament.name} sont ouvert !`);
		console.log('Tournament status updated : Sign In (Return step)');
	},
	
	addParticipant: async function(interaction, user_id, name, tournamentId, fake = false) {
		const Tournament = await TournamentHelpers.getTournament(tournamentId);
		const participantCheck = models.Participants.findOne({ where : { user_id: user_id, tournamentId: parseInt(tournamentId) } });

		// Si le joueur n'est pas déjà enregistré
		if (!participantCheck.length) {

			// console.log(interaction)
			if (!fake) {
				await models.Participants.create({ user_id: user_id, name: name, tournamentId: parseInt(tournamentId) });
				const role = await interaction.member.guild.roles.fetch(Tournament.roleId);
				await interaction.member.roles.add(role);
			}
			else {
				await models.Participants.create({ user_id: user_id, name: name, tournamentId: parseInt(tournamentId), checkin: 1 });
			}
		}
		else {
			interaction.reply({ content: 'Vous êtes déjà inscrit au tournoi !', ephemeral: true });
		}

	},
	addParticipantToTeam: async function(interaction) {
		console.log(interaction.customId);
		const [ tournamentId, teamId, threadId ] = interaction.customId.replace('playersforteam_', '').split('_');
		const users = interaction.users;
		const { webhook, Tournament } = await TournamentHelpers.getChannel(interaction, tournamentId, 'registeredChannel');

		// CHECKER SI UN JOUEUR EST DEJA PRESENT !!!!!!

		await interaction.reply({ content: 'Sélection terminé !', ephemeral: true });
		await models.Participants.destroy({ where: { teamId : teamId } });
		const error = [];
		console.log(users);
		for (const user of users) {
			const u = user[1];
			const participantCheck = await models.Participants.findOne({
				where: {
					user_id: u.id,
					tournamentId: parseInt(tournamentId),
					'$team.teamStatus$': 'locked',
				},
				include:{
					model: models.Teams,
					required: true,
				},

			});
			// console.log(participantCheck);
			// Si le joueur n'est pas déjà enregistré
			if (!participantCheck) {
				await models.Participants.create({ user_id: u.id, name: u.username, tournamentId: parseInt(tournamentId), teamId: parseInt(teamId) });
				const role = await interaction.member.guild.roles.fetch(Tournament.roleId);
				await interaction.member.roles.add(role);
				// await interaction.followUp({ content: `Joueur ${u.username} prêt à être ajouté à l'équipe \n\t`, ephemeral: true });
			}
			else {
				// await interaction.followUp({ content: `Joueur ${u.username} déjà dans une équipe, sélectionnez une autre personne \n\t`, ephemeral: true });
				await error.push({ name: u.username });
				console.log(error);
			}
		};

		console.log(error);

		if (!error.length) {
			await interaction.followUp({ content: 'Joueur prêt à être ajouté à l\'équipe \n\t', ephemeral: true });
			const lockButton = new ButtonBuilder()
				.setCustomId(`lockplayersforteam_${tournamentId}_${teamId}`)
				.setLabel('Confirmer les joueurs')
				.setStyle(ButtonStyle.Danger);

			const lock = new ActionRowBuilder().addComponents(lockButton);

			await webhook.send({
				content: 'Confirmer la sélection ?',
				components: [lock],
				threadId: threadId,
			});
		}
		else {
			console.log(error.map(u => u.name));
			await interaction.followUp({ content: `Le(s) joueur(s) : 
			 ${error.map(u => u.name).join(', ')} 
			 possède(nt) déjà dans une équipe, sélectionnez un autre joueur \n\t`, ephemeral: true });
		}


	},
	removeParticipant: async function(interaction, user_id, tournamentId) {
		const Tournament = await TournamentHelpers.getTournament(tournamentId);
		const role = await interaction.member.guild.roles.fetch(Tournament.roleId);
		await interaction.member.roles.delete(role);
		await models.Participants.destroy({ where: { user_id: user_id, tournamentId: parseInt(tournamentId) } });
	},
	cancelTournament: async function(interaction, tournamentId) {
		const Tournament = await TournamentHelpers.getTournament(tournamentId);
		const participants = await models.Participants.findAll({ where : { tournamentId : tournamentId } });
		for (const participant of participants) {
			const user = await interaction.member.guild.members.fetch(participant.id);
			const role = await interaction.member.guild.roles.fetch(Tournament.roleId);
			await user.roles.remove(role);
		}

		await models.Tournaments.destroy({ where: { id: parseInt(tournamentId) } });
		await manager.delete.tournament(tournamentId);
		await interaction.reply('Tournoi supprimé.');

	},
};


module.exports = { Tournaments };