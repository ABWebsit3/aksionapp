const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, spoiler, EmbedBuilder, userMention, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType } = require('discord.js');
const { models } = require('../models');


const TournamentHelpers = {
	createChannel: async function(interaction, options) {
		const channel = await interaction.member.guild.channels.create(options);

		if (typeof options.type == 'undefined') {
			await channel.createWebhook({
				name: 'Aksion',
				avatar: 'assets/avatar.png',
			}).then(/* console.log*/)
				.catch(console.error);
		}

		return channel;
	},
	getTournament: async function(tournamentId) {
		const Tournament = await models.Tournaments.findOne({ where : { id : tournamentId } });
		return {

			id: Tournament.id,
			name: Tournament.name,
			channels: JSON.parse(Tournament.channels),
			status: Tournament.status,
			settings : JSON.parse(Tournament.settings),
			roleId : Tournament.roleId,

		};
	},
	/**
	 * Récupère les salons et retourne le webhook, object Channel & objet Tournament
	 * @param {*} interaction
	 * @param {Int} tournamentId
	 * @param {String} channel
	 * @param {String} status
	 * @returns
	 */
	getChannel: async function(interaction, tournamentId, channel) {
		const Tournament = await this.getTournament(tournamentId);
		const Channel = Tournament.channels.filter(data => data.name === channel)[0];
		const ChannelObject = await interaction.client.channels.cache.get(Channel.id);
		let webhook = {};

		if (ChannelObject.type != ChannelType.GuildCategory) {
			const webhooks = await ChannelObject.fetchWebhooks();
			webhook = webhooks.first();
		}

		return { webhook, ChannelObject, Tournament };
	},
	getRole: async function(interaction, roleId) {
		return await interaction.member.guild.roles.fetch(roleId) || 'none';
	},
	/* getUser: async function(interaction, userId){
		const models.User
		return
	},*/
	adminsControlsButtons : async function(interaction, tournament_id, status) {
		const { webhook, Tournament, ChannelObject : AdminChannel } = await this.getChannel(interaction, tournament_id, 'adminChannel', status);
		const messages = await AdminChannel.messages.fetch();

		// console.log(Tournament.settings);
		const messagefiltered = messages.filter(message => message.webhookId == webhook.id).first();

		const adminEmbed = {
			color: 0x0099ff,
			title: 'Panneau d\'administration',
			fields: [
				{
					name: 'Nom du tournoi',
					value: Tournament.name,
				},
				{
					name: 'Type de tournoi',
					value: Tournament.settings.TournamentType.name,

				},
				{
					name: 'Taille des équipes',
					value: Tournament.settings.TeamsSizes,
				},
				{
					name: 'Round de consolation',
					value: Tournament.settings.ConsolationRound ? 'Oui' : 'Non',
				},
				{
					name: 'État du tournoi',
					value: Tournament.status.charAt(0).toUpperCase() + Tournament.status.slice(1),
				},
			],
		};

		const openSignInButton = new ButtonBuilder()
			.setCustomId('startSignin_' + tournament_id)
			.setLabel('✅ Ouvrir l\'inscription')
			.setStyle(ButtonStyle.Success);

		const openCheckInButton = new ButtonBuilder()
			.setCustomId('startCheckin_' + tournament_id)
			.setLabel('✍ Ouvrir le Check-in')
			.setStyle(ButtonStyle.Success);

		const startTournamentButton = new ButtonBuilder()
			.setCustomId('start_' + tournament_id)
			.setLabel('Démarrer le tournoi')
			.setStyle(ButtonStyle.Success);

		switch (Tournament.status) {
		case 'waiting':
			openCheckInButton.setDisabled(true);
			startTournamentButton.setDisabled(true);
			break;
		case 'signin' :
			openSignInButton.setDisabled(true);
			startTournamentButton.setDisabled(true);
			break;
		case 'checkin' :
			openCheckInButton.setDisabled(true);
			openSignInButton.setDisabled(true);
			break;
		}

		const row = new ActionRowBuilder()
			.addComponents([openSignInButton, openCheckInButton, startTournamentButton]);

		if (Tournament.status != 'waiting' || Tournament.status != 'signin') {
			const returnButton = new ButtonBuilder()
				.setCustomId('return_' + tournament_id)
				.setLabel('⬅ Retour à l\'étape précédente')
				.setStyle(ButtonStyle.Danger);

			row.addComponents(returnButton);
		}

		if (Tournament.settings.TournamentType.value == 'random_teams') {
			const shuffleButton = new ButtonBuilder()
				.setCustomId('shuffle_teams_' + tournament_id)
				.setLabel('♻')
				.setStyle(ButtonStyle.Success);
			row.addComponents(shuffleButton);
		}

		if (messagefiltered) {
			await webhook.editMessage(messagefiltered.id, {
				embeds: [adminEmbed],
				components: [row],
			});
		}
		else {
			await webhook.send({
				embeds: [adminEmbed],
				components: [row],
			});
		}


	},
	loadTournamentModal: async function(interaction) {

		const tournamentSettingsModal = new ModalBuilder()
			.setCustomId('tournamentSettings')
			.setTitle('Paramètres du tournoi');
		// Add components to modal
		// Create the text input components
		const tournamentName = new TextInputBuilder()
			.setCustomId('tournamentName')
			.setLabel('Nom du tournoi')
			.setValue('Nouveau tournoi')
			.setStyle(TextInputStyle.Short);

		const tournamentTeamsize = new TextInputBuilder()
			.setCustomId('tournamentTeamsize')
			.setLabel('Taille des équipes (1 à 5)')
			.setValue('5')
			.setStyle(TextInputStyle.Short);

		// An action row only holds one text input,
		// so you need one action row per text input.
		const firstActionRow = new ActionRowBuilder().addComponents(tournamentName);
		const secondActionRow = new ActionRowBuilder().addComponents(tournamentTeamsize);

		// Add inputs to the modal
		tournamentSettingsModal.addComponents(firstActionRow, secondActionRow);
		await interaction.showModal(tournamentSettingsModal);
	},
	loadCreateTeamModal: async function(interaction) {

		const createTeamModal = new ModalBuilder()
			.setCustomId('createTeam')
			.setTitle('Créer une nouvelle équipe');
		// Add components to modal
		// Create the text input components
		const teamName = new TextInputBuilder()
			.setCustomId('teamName')
			.setLabel('Nom de l\'équipe')
			.setStyle(TextInputStyle.Short);


		// An action row only holds one text input,
		// so you need one action row per text input.
		const firstActionRow = new ActionRowBuilder().addComponents(teamName);

		// Add inputs to the modal
		createTeamModal.addComponents(firstActionRow);
		await interaction.showModal(createTeamModal);
	},
	setMatchScore: async function(interaction, bracket, match_id) {

		const current_match = bracket.match.filter(match => match.id == match_id)[0];
		const opponent1 = bracket.participant.filter(participant => participant.id == current_match.opponent1.id)[0];
		const opponent2 = bracket.participant.filter(participant => participant.id == current_match.opponent2.id)[0];

		const setMatchScoreModal = new ModalBuilder()
			.setCustomId('matchScore')
			.setTitle(`Résultat du match ${match_id + 1}`);
		// Add components to modal
		// Create the text input components
		const opponent1Field = new TextInputBuilder()
			.setCustomId('opponent1')
			.setLabel(opponent1.name)
			.setValue('0')
			.setStyle(TextInputStyle.Short);

		const opponent2Field = new TextInputBuilder()
			.setCustomId('opponent2')
			.setLabel(opponent2.name)
			.setValue('0')
			.setStyle(TextInputStyle.Short);

		// An action row only holds one text input,
		// so you need one action row per text input.
		const firstActionRow = new ActionRowBuilder().addComponents(opponent1Field);
		const secondActionRow = new ActionRowBuilder().addComponents(opponent2Field);

		// Add inputs to the modal
		setMatchScoreModal.addComponents(firstActionRow, secondActionRow);
		await interaction.showModal(setMatchScoreModal);
	},
	showMatchThreads : async function(tournament_id, manager, webhook, ChannelObject, opponnents = null) {
		const bracket = await manager.get.tournamentData(parseInt(tournament_id));
		const currentStage = await manager.get.currentStage(parseInt(tournament_id));

		if (currentStage) {
			const currentRound = await manager.get.currentRound(currentStage.id);
			const current_match = bracket.match.filter(match => match.round_id == currentRound.id);

			current_match.forEach(async match => {
				if (match.opponent1 != null && match.opponent2 != null) {
					const opponent1 = bracket.participant.filter(participant => participant.id == match.opponent1.id && participant.name);
					const opponent2 = bracket.participant.filter(participant => participant.id == match.opponent2.id && participant.name);
					const thread = await ChannelObject.threads.create({
						name: `${opponent1[0].name} vs ${opponent2[0].name}`,
						autoArchiveDuration: 1440, // 1 Jour
						reason: `${opponent1[0].name} vs ${opponent2[0].name}`,
					});
					if (thread.joinable) await thread.join();

					const scoreButton = new ButtonBuilder()
						.setCustomId(`score_${tournament_id}_${match.id}`)
						.setLabel('Score')
						.setStyle(ButtonStyle.Secondary);

					const row = new ActionRowBuilder()
						.addComponents(scoreButton);

					const threadMessage = await webhook.send({
						content : `${spoiler('<@everyone>')}
Match - ${opponent1[0].name} vs ${opponent2[0].name}
Entrer votre score à la fin du match`,
						// embeds: [scoreThread],
						components: [row],
						threadId: thread.id,
					});
					threadMessage.pin();
				}
			});
		}
		else {
			// Tournois terminé !
			const finalStage = bracket.stage.filter(stage => stage.tournament_id == parseInt(tournament_id));
			console.log(finalStage);
			const final = await manager.get.finalStandings(finalStage[0].id);
			const winner = final[0].name;

			await webhook.send({
				content : `${spoiler('<@everyone>')}
Tournoi terminé
Gagnant : ${winner} `,
				// embeds: [scoreThread],

			});
		}

	},
	updateMatchThreads : async function(interaction, tournamentId, manager, opponnents) {
		const { webhook, ChannelObject } = await this.getChannel(interaction, tournamentId, 'scoreChannel', 'started');
		// ChannelObject.threads.cache.every(async thread => await thread.delete());
		this.showMatchThreads(tournamentId, manager, webhook, ChannelObject, opponnents);
	},
	showRegisteredUsers : async function(interaction, tournament_id) {

		const Tournament = await models.Tournaments.findOne({ where: { id: tournament_id } });
		const Channels = JSON.parse(Tournament.channels);
		const registeredChannel = Channels.filter(data => data.name === 'registeredChannel')[0];
		const participants = await models.Participants.findAll({ where: { tournamentId: tournament_id } });
		const registeredChannelObject = interaction.client.channels.cache.get(registeredChannel.id);
		const webhooks = await registeredChannelObject.fetchWebhooks();
		const webhook = webhooks.first();
		const messages = await registeredChannelObject.messages.fetch();

		registeredChannelObject.bulkDelete(messages);

		const ParticipantsEmbed = new EmbedBuilder()
			.setColor(0x0099FF)
			.setTitle('Liste des participants');
		let text = '';
		for (const player of participants) {
			if (player.user_id) {
				text += `${userMention(player.user_id)}
						`;
			}
			else {
				text += `${player.name}
					`;
			}
		}

		await ParticipantsEmbed.addFields({ name: 'Participants', value: text });
		// Charger la liste des participants pour afficher/Mettre à jour
		await webhook.send({ embeds: [ParticipantsEmbed] });

	},
	showRegisteredTeams : async function(interaction, tournamentId) {


		const { webhook, ChannelObject : registeredChannel, Tournament } = await this.getChannel(interaction, tournamentId, 'registeredChannel', 'signin');

		const teams = await models.Teams.findAll({ where: { tournamentId: tournamentId } });

		const messages = await registeredChannel.messages.fetch();

		await registeredChannel.bulkDelete(messages);

		/* const ParticipantsEmbed = new EmbedBuilder()
			.setColor(0x0099FF)
			.setTitle('Liste des équipes');*/
		let text = '';
		for (const t of teams) {
			const participants = await models.Participants.findAll({ where: { teamId: t.id } });

			text += `\n## [${t.name}] \n`;
			for (const player of participants) {
				if (player.user_id) {
					text += `- ${userMention(player.user_id)} ${player.checkin ? '✅' : ''} \n`;
				}
				else {
					text += `- ${player.name} \n`;
				}

			}
			console.log(text);
		}

		await webhook.send({ content : text });

	},
	confirmTeamSelection: async function(interaction) {
		const [ tournamentId, teamId ] = interaction.customId.replace('lockplayersforteam_', '').split('_');

		await models.Teams.update({ teamStatus: 'locked' }, { where: {
			id: teamId,
		} });

		this.showRegisteredTeams(interaction, tournamentId);
		await interaction.channel.messages.fetch().then(messages => {
			messages.map(m => {
				console.log(m);
				m.delete();
			});
		});
		await interaction.reply('Joueurs confirmé ! Bonne chance!');
	},
	confirmPlayerCheckIn: async function(interaction) {
		const tournamentId = interaction.customId.replace('checkin_', '');
		const userId = interaction.user.id;
		const user = await models.Participants.findOne({ where : { user_id: userId, checkin : true } });
		if (!user) {
			await models.Participants.update({ checkin : true }, { where: { user_id : userId } });
			this.showRegisteredTeams(interaction, tournamentId);
			interaction.reply({ content:'Check-In confirmé ! GL HF!', ephemeral: true });
		}
		else {
			interaction.reply({ content:'Check-In déjà confirmé !', ephemeral: true });
		}
	},

};

module.exports = { TournamentHelpers };
