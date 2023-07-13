const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, spoiler, EmbedBuilder, userMention, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { models } = require('../models');


const TournamentHelpers = {
	createChannel: async function(interaction, options) {
		const channel = await interaction.member.guild.channels.create(options);

		if (typeof options.type == 'undefined') {
			channel.createWebhook({
				name: 'Aksion',
				avatar: 'assets/avatar.png',
			}).then(console.log)
				.catch(console.error);
		}

		return channel;
	},
	getTournament: async function(tournamentId) {
		const Tournament = await models.Tournaments.findOne({ where : { id : tournamentId } });
		return {
		
			id: Tournament.id,
			name: Tournament.name,
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
	getChannel: async function(interaction, tournamentId, channel, status = 'waiting') {
		const Tournament = await models.Tournaments.findOne({ where: { id: tournamentId, status : status } });
		const Channels = JSON.parse(Tournament.channels);
		const Channel = Channels.filter(data => data.name === channel)[0];
		const ChannelObject = interaction.client.channels.cache.get(Channel.id);

		const webhooks = await ChannelObject.fetchWebhooks();
		const webhook = webhooks.first();

		return { webhook, ChannelObject, Tournament };
	},

	shuffleButtons : async function(interaction, adminChannel, content, tournament_id, ...buttons) {
		const adminChannelObject = interaction.client.channels.cache.get(adminChannel.id);

		const shuffleButton = new ButtonBuilder()
			.setCustomId('shuffle_teams_' + tournament_id)
			.setLabel('♻')
			.setStyle(ButtonStyle.Success);

		const startTournamentButton = new ButtonBuilder()
			.setCustomId('start_' + tournament_id)
			.setLabel('Go !')
			.setStyle(ButtonStyle.Success);


		const row = new ActionRowBuilder()
			.addComponents([shuffleButton, startTournamentButton]);

		const messageShuffle = await adminChannelObject.send({
			content: content,
			components: [row],
		});
		return messageShuffle;
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
	showTournamentSettings: async function(interaction, tournamentId) {
		const { ChannelObject : AdminChannel } = await this.getChannel(interaction, tournamentId, 'adminChannel')
		const select = new StringSelectMenuBuilder()
			.setCustomId('starter')
			.setPlaceholder('Make a selection!')
			.addOptions(
				new StringSelectMenuOptionBuilder()
					.setLabel('Random Teams')
					.setDescription('The dual-type Grass/Poison Seed Pokémon.')
					.setValue('bulbasaur'),
				new StringSelectMenuOptionBuilder()
					.setLabel('Team creation')
					.setDescription('The Fire-type Lizard Pokémon.')
					.setValue('charmander'),
			);

		const row = new ActionRowBuilder()
			.addComponents(select);

		await AdminChannel.send({
			content: 'Tournament Settings',
			components: [row],
		});
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
		const bracket = await manager.get.tournamentData(tournament_id);
		const currentStage = await manager.get.currentStage(tournament_id);
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
			const winner = await this.getWinner(opponnents);
			console.log(winner);
			await webhook.send({
				content : `${spoiler('<@everyone>')}
Tournoi terminé `,
				// embeds: [scoreThread],

			});
		}

	},
	updateMatchThreads : async function(interaction, tournamentId, manager, opponnents) {
		const { webhook, ChannelObject } = await this.getChannel(interaction, tournamentId, 'scoreChannel', 'started');
		ChannelObject.threads.cache.every(async thread => await thread.delete());
		this.showMatchThreads(tournamentId, manager, webhook, ChannelObject, opponnents);
	},
	getWinner : async function(opponnents) {
		return opponnents['1'].result == 'win' ? opponnents['1'].name : opponnents['2'].name;
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
		await participants.forEach(async player => {
			if (player.user_id) {
				text += `${userMention(player.user_id)}
						`;
			}
			else {
				text += `${player.name}
					`;
			}
		});

		await ParticipantsEmbed.addFields({ name: 'Participants', value: text });
		// Charger la liste des participants pour afficher/Mettre à jour
		await webhook.send({ embeds: [ParticipantsEmbed] });

	},

};

module.exports = { TournamentHelpers };
