const { SlashCommandBuilder, ModalBuilder, TextInputStyle, ActionRowBuilder, TextInputBuilder } = require('discord.js');
const { models } = require('./../../models');
const { ChannelType } = require('discord.js');
const { EmbedBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
	.setName('tournoi')
	.setDescription('Provides information about the user.')
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
	);


const execute = async function(interaction) {
	if (interaction.options._subcommand === 'create') {
		console.log('Tournament created');

		// Chargement du modal pour la configuration du tournoi
		loadTournamentSettings(interaction);
		const filter = (_interaction) => _interaction.customId === 'tournamentSettings';
		interaction.awaitModalSubmit({ filter, time: 15_000 })
		.then(_interaction => initTournament(_interaction))
		.catch(console.error);

	}
	else if (interaction.options._subcommand === 'delete') {
		await interaction.deferReply({ ephemeral: true });
		console.log('delete tournament');
		console.log(interaction);
		const tournament = await models.Tournaments.findOne({ where: { id : interaction.options._hoistedOptions[0].value } });
		const tournamentChannels = JSON.parse(tournament.channels);
		tournamentChannels.map(async channel => {
			console.log(channel);
			await interaction.member.guild.channels.delete(channel.id, 'Delete tournaments channels');
		});
		await models.Tournaments.destroy({ where: { id : interaction.options._hoistedOptions[0].value } });
		await interaction.editReply({ content: 'Tournoi supprimé', ephemeral: true });
	}

	// interaction.user is the object representing the User who ran the command
	// interaction.member is the GuildMember object, which represents the user in the specific guild

};
const autocomplete = async function(interaction) {

	if (interaction.options._subcommand === 'delete') {
		console.log('Witch the tournament');
		const result = await models.Tournaments.findAll();
		const choices = result.map(r => {return { name : r.name, value: r.id.toString() };});
		if (interaction.isAutocomplete()) {
			interaction.respond(choices)
				.catch(console.error);
		}
	}

};

const initTournament = async function(interaction) {

	if (interaction.customId === 'tournamentSettings') {
		await interaction.deferReply({ ephemeral: true });
		const result = await models.Tournaments.create({
			name : interaction.fields.getTextInputValue('tournamentName'),
			teamsSize : interaction.fields.getTextInputValue('tournamentTeamsize'),
		});

		const groupChannel = await interaction.member.guild.channels.create({ type: ChannelType.GuildCategory, name: result.dataValues.name });
		const lobbyChannel = await interaction.member.guild.channels.create({ name: 'Lobby', reason: 'Lobby for players', parent : groupChannel.id });
		const scoreChannel = await interaction.member.guild.channels.create({ name: 'Score', reason: 'Lobby for players', parent : groupChannel.id });
		const adminChannel = await interaction.member.guild.channels.create({ name: 'Administration', reason: 'Lobby for players', parent : groupChannel.id });
		const channelGroup = [
			{
				name: 'lobbyChannel',
				id: lobbyChannel.id,
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

		const channel = interaction.client.channels.cache.get(adminChannel.id);
		// inside a command, event listener, etc.
		const exampleEmbed = new EmbedBuilder()
			.setColor(0x0099FF)
			.setTitle('Some title')
			.setURL('https://discord.js.org/')
			.setAuthor({ name: 'Some name', iconURL: 'https://i.imgur.com/AfFp7pu.png', url: 'https://discord.js.org' })
			.setDescription('Some description here')
			.setThumbnail('https://i.imgur.com/AfFp7pu.png')
			.addFields(
				{ name: 'Regular field title', value: 'Some value here' },
				{ name: '\u200B', value: '\u200B' },
				{ name: 'Inline field title', value: 'Some value here', inline: true },
				{ name: 'Inline field title', value: 'Some value here', inline: true },
			)
			.addFields({ name: 'Inline field title', value: 'Some value here', inline: true })
			.setImage('https://i.imgur.com/AfFp7pu.png')
			.setTimestamp()
			.setFooter({ text: 'Some footer text here', iconURL: 'https://i.imgur.com/AfFp7pu.png' });

		channel.send({ embeds: [exampleEmbed] });

		await models.Tournaments.update({
			guildId: groupChannel.guildId,
			channels: JSON.stringify(channelGroup),
		}, {
			where: {
				id: result.id,
			},
		});
		await interaction.editReply({ content: 'Tournoi créé', ephemeral: true });
	}

};


module.exports = {
	data: data,
	execute,
	autocomplete,
};


async function loadTournamentSettings(interaction) {

	const tournamentSettingsModal = new ModalBuilder()
		.setCustomId('tournamentSettings')
		.setTitle('Paramètres du tournoi');
	// Add components to modal
		// Create the text input components
	const tournamentName = new TextInputBuilder()
		.setCustomId('tournamentName')
		    // The label is the prompt the user sees for this input
		.setLabel('Nom du tournoi')
		.setValue('Nouveau tournoi')
		    // Short means only a single line of text
		.setStyle(TextInputStyle.Short);

	const tournamentTeamsize = new TextInputBuilder()
		.setCustomId('tournamentTeamsize')
		.setLabel('Taille des équipes')
		.setValue('5')
		    // Paragraph means multiple lines of text.
		.setStyle(TextInputStyle.Short);

	// An action row only holds one text input,
	// so you need one action row per text input.
	const firstActionRow = new ActionRowBuilder().addComponents(tournamentName);
	const secondActionRow = new ActionRowBuilder().addComponents(tournamentTeamsize);

	// Add inputs to the modal
	tournamentSettingsModal.addComponents(firstActionRow, secondActionRow);
	await interaction.showModal(tournamentSettingsModal);
}